// vim:hlsearch:nu:
/**
 * TODO loading (g)zipped csv
 * TODO string col hashing
 * TODO document cum ops
 * TODO binarizer
 * TODO dates
 */
const { createUnzip, createGzip, createGunzip, createDeflate } = require('zlib');
const util = require('util');
const { dirname, join } = require('path');
const { gunzipSync, gzipSync } = require('zlib');
const { mkdirSync, readdirSync, existsSync, writeFileSync, readFileSync, createReadStream, createWriteStream } = require('fs');

const stringifyCSV = require('csv-stringify');

const Series = require('./Series');
const { randInt } = require('./rand');
const { readCSV } = require('./load');
const { fmtFloat, unify, fmtFloatSI, dtypeRegex } = require('./utils');
const log = require('./log');
const env = require('./env');

/**
 * @param {!Array<Array<*>>} xs
 * @returns {!Array<Array<*>>} xs^T
 * @private
 */
function transpose(xs) {
  /**
   * from [1, 2 , 3] to:
   *
   * [[1],
   *  [2],
   *  [3]]
   */
  if (xs[0].constructor.name !== 'Array') {
    return xs.map(x => [x]);
  }
  const colCount = xs[0].length; // assume equi-sized
  const rowCount = xs.length;
  const m = Array(colCount).fill(0).map(_ => Array(rowCount).fill(0));
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < xs[i].length; j++) {
      m[j][i] = xs[i][j];
    }
  }
  return m;
}

class DataFrame {
  /**
   * @param {!DataFrame|!Object<!Array<!String>|!Array<!Number>>|!Array<!Array<!Number|!String>>|!Array<!TypedArray|!Array<!Number>|!Array<!String>>|!Map<!Array<!Number>|!Array<!String>>} data
   * @param {'cols'|'rows'|'map'|'obj'} [what]
   * @param {?Array<!String>} [colNames] labels for every column (#cols === #labels)
   * @param {!Array<?String>} [dtypes]
   */
  constructor(data = [], what = 'rows', colNames = null, dtypes = []) {
    // empty
    if (data.length === 0) {
      log.debug('data is empty, making an empty DataFrame');
      this._cols = Series.from([]);
      this.colNames = Series.from([]);

      // another data frame, shallow copy it
    } else if (data.constructor.name === this.constructor.name) {
      log.info('data is another DataFrame, making a shallow copy');
      this._cols = Array.from(data._cols);
      this.colNames = Array.from(data.colNames);

      // object { colName => col, ... }
    } else if (data.constructor.name === 'Object' || what.match(/^obj/i)) {
      log.info('data is object, using keys as col names and vals as cols');
      this._cols = Object.values(data).map((c, cIdx) => Series.from(c, dtypes[cIdx] || null));
      this.colNames = Object.keys(data);

      // map { col1 => col2, ... }
    } else if (data.constructor.name === 'Map' || what.match(/^map/i)) {
      log.info('data is map, using keys as col1 and vals as col2');
      this._cols = [
        Series.from(Array.from(data.keys()), dtypes[0] || null),
        Series.from(Array.from(data.values()), dtypes[1] || null),
      ];
      this.colNames = colNames === null ? ['Key', 'Value'] : colNames;

    } else {

      // array of rows
      if (what.match(/^row/i)) {
        log.info('data is rows, transposing to columns');
        this._cols = transpose(data).map((c, cIdx) => {
          log.debug(`converting transposed col #${cIdx}`);
          return Series.from(c, dtypes[cIdx] || null);
        });

      // array of cols
      } else {
        log.debug('data is columns');
        this._cols = data.map((c, cIdx) => {
          const isSeries = Series.isSeries(c);
          const dtypeGiven = dtypes[cIdx] !== null && dtypes[cIdx] !== undefined;
          const noNeedToConvert = isSeries && (!dtypeGiven || c.dtype === dtypes[cIdx]);
          if (noNeedToConvert) {
            log.debug(`no need to convert col #${cIdx}`);
            return c;
          }
          log.debug(`converting col #${cIdx}`);
          // else
          return Series.from(c, dtypes[cIdx] || null);
        });
      }

      if (colNames === null) {
        this.colNames = Array(this.nCols).fill(0).map((_, idx) => idx);
      } else {
        this.colNames = colNames;
      }
    }

    const attrNames = new Set(this.colNames);
    // index using cols integers AND column names
    Array(this.nCols).fill(0).map((_, idx) => attrNames.add(idx));

    /*
     * easy access e.g. df.age, df.salary
     * easy replacement (assignment) of cols e.g. df.age = df2.age;
     */
    for (const name of attrNames) {
      Object.defineProperty(this, name, {
        get() {
          return this.col(name);
        },
        set(newCol) {
          // broadcast
          if (newCol.constructor.name === 'Number') {
            for (let i = 0; i < newCol.length; i++) {
              this._cols[this.colIdx(name)] = newCol[i];
            }
          } else {
            this._cols[this.colIdx(name)] = newCol;
          }
        },
      });
    }

    this.irow = function* (rIdx) {
      for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
        yield this.val(rIdx, cIdx);
      }
    };

    function* rowsIter() {
      for (let r = 0; r < this.length; r++) {
        yield this.row(r);
      }
    }

    // make this.rowsIter a getter
    Object.defineProperty(this, 'rowsIter', { get: rowsIter });
    this[Symbol.iterator] = rowsIter;

    // each produces a number from an array
    const aggsNum = [
      'mean',
      'median',
      'Q1',
      'Q3',
      'var',
      'stdev',
      'mad',
      'min',
      'max',
      'range',
      'IQR',
      'memory',
      'skewness',
      'kurtosis',
    ];

    /*
     * each aggregare op is a function (Series => Number)
     * it changes the shape of the data frame from n x m => m x 2
     */
    for (const agg of aggsNum) {
      if (this[agg] === undefined) {
        this[agg] = function (...args) {
          return this.agg(agg, 'num', ...args);
        };
      }
    }

    for (const agg of ['mode', 'argMax', 'argMin']) {
      if (this[agg] === undefined) {
        this[agg] = function (...args) {
          return this.agg(agg, 'all', ...args);
        };
      }
    }

    /*
     * each forward function is forwarded to the underlying series
     * ForwardFunct :: Series (len = n) => Series (len = n)
     */
    for (const f of ['replace', 'map', 'reverse', 'zipWith', 'zipWith3', 'cum']) {
      if (this[f] !== undefined) continue;
      this[f] = function (colId = null, ...args) {
        return this.call(colId, f, 'all', ...args);
      };
    }

    for (const f of ['labelEncode', 'parse']) {
      if (this[f] !== undefined) continue;
      this[f] = function (colId = null, ...args) {
        return this.call(colId, f, 'str', ...args);
      };
    }

    const functsNum = [
      'abs',
      'add',
      'cast',
      'cbrt',
      'ceil',
      'clip',
      'cube',
      'cum',
      'div',
      'downcast',
      'dropNaN',
      'floor',
      'kBins',
      'mul',
      'normalize',
      'pow',
      'round',
      'sqrt',
      'square',
      'sub',
      'trunc',
    ];
    for (const f of functsNum) {
      if (this[f] !== undefined) continue;
      this[f] = function (colId = null, ...args) {
        return this.call(colId, f, 'num', ...args);
      };
    }

    for (const pair of [
      ['add', 'sum'],
      ['sub', 'diff'],
      ['mul', 'prod'],
      ['div', 'quot']]) {
      const [op, name] = pair;
      if (this[name] === undefined) {
        this[name] = function (...args) {
          return this.agg(op, 'num', ...args);
        };
      }
    }
  }

  /**
   * @returns {!Set<!Number>} set of column indexes
   * @private
   */
  get _numColIdxs() {
    const { dtypes } = this;
    const colIdxs = new Set();
    for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
      if (dtypes[cIdx].match(dtypeRegex)) {
        colIdxs.add(cIdx);
      }
    }
    return colIdxs;
  }

  /**
   * @returns {!Set<!Number>} set of column indexes
   * @private
   */
  get _strColIdxs() {
    const numCols = this._numColIdxs;
    return new Set(this.colNames.filter((_, idx) => !numCols.has(idx)));
  }

  /**
   * @param {!String|!Number} colId
   * @returns {!Number} column index
   * @private
   */
  colIdx(colId) {
    // resolve named column
    if (Number.isInteger(colId)) {
      // resolve negative idx
      if (colId < 0) {
        return this.colIdx(this.nCols + colId);
      } else if (colId >= this.nCols) {
        throw new Error(`there is no column #${colId}, out of bounds`);
      } else {
        return colId;
      }
    } else {
      const idx = this.colNames.findIndex(colName => colName === colId);
      if (idx < 0) {
        throw new Error(`failed to find matching column for "${colId}"`);
      }
      return idx;
    }
  }

  /**
   * @returns {!DataFrame} a data frame with numeric cols
   */
  get numeric() {
    return this.select(...this._numColIdxs);
  }

  /**
   * @returns {!DataFrame} a data frame with numeric cols
   */
  get nominal() {
    return this.select(...this._strColIdxs);
  }

  /**
   * @param {!String|!Number} colId
   * @returns {Array<String>|TypedArray} column
   */
  col(colId) {
    return this._cols[this.colIdx(colId)];
  }

  /**
   * @param {!Number} idx
   * @returns {!Array<*>} row
   */
  row(idx) {
    return Array(this.nCols)
      .fill(0)
      .map((_, cIdx) => this.val(idx, cIdx));
  }

  /**
   * @param {!Number} rowIdx
   * @param {!String|!Number} colId
   * @returns {!Number|!String} selects a val
   */
  val(rowIdx, colId) {
    return this.col(colId)[rowIdx];
  }

  /**
   * @param {?Number} [n]
   * @returns {!DataFrame} data frame
   */
  head(n = null) {
    if (n === null) {
      return this.tail(env.HEAD_LEN);
    }
    return this.slice(0, n);
  }

  /**
   * @param {?Number} [n]
   * @returns {!DataFrame} data frame
   */
  tail(n = null) {
    if (n === null) {
      return this.tail(env.HEAD_LEN);
    }
    return this.slice(this.length - n, this.length);
  }

  /**
   * @returns {!Number} number of rows
   */
  get length() {
    if (this._cols[0] === undefined) {
      return 0;
    } else {
      return this._cols[0].length;
    }
  }

  /**
   * @returns {!Number} number of columns
   */
  get nCols() {
    return this._cols.length;
  }

  /**
   * @param {...!String} colIds
   * @returns {!DataFrame} data frame
   */
  dtype(...colIds) {
    if (colIds.length === 0) {
      return this.dtype(...this.colNames);
    }
    const colIdxs = colIds.map(id => this.colIdx(id));
    const df = this.agg(col => col.dtype, cIdx => colIdxs.indexOf(cIdx) >= 0).rename(1, 'dtype');
    return df;
  }

  /**
   * @returns {!Array<!String>} data types for all columns
   */
  get dtypes() {
    return this._cols.map(c => c.dtype);
  }

  /**
   * @param {...<!Number|!String>} colIds
   * @return {!DataFrame} data frame
   */
  select(...colIds) {
    const cols = [];
    const colNames = [];

    for (const i of new Set(colIds.map(id => this.colIdx(id)))) {
      cols.push(this._cols[i]);
      colNames.push(this.colNames[i]);
    }

    return new DataFrame(cols, 'cols', colNames);
  }

  /**
   * @param {...!String|...!Number|Array<!Number|!String>} params pairs of colId, newName
   * @returns {!DataFrame} data frame with renamed col
   */
  rename(...params) {
    if (params.length === 1 && params[0].constructor.name === 'Array') {
      const pairs = params[0].map((newName, cIdx) => [cIdx, newName]);
      const args = pairs.reduce((pair1, pair2) => pair1.concat(pair2), []);
      return this.rename(...args);
    } else if (params.length === 1 && this.nCols === 1) {
      log.info('colId not specified for rename');
      return this.rename(0, params[0]);
    } else if (params.length % 2 !== 0) {
      throw new Error('you need to provide pairs of colId, newName (e.g. df.rename(1, "Width", -2, "Length"))');
    }
    const colNames = Array.from(this.colNames);
    for (let i = 1; i < params.length; i += 2) {
      const colId = params[i - 1];
      const newName = params[i];
      const colIdx = this.colIdx(colId);
      colNames[colIdx] = newName;
    }
    return new DataFrame(Array.from(this._cols), 'cols', colNames);
  }

  /**
   * @param {!Number|!String} colId
   * @param {!String|!Function} f
   * @param {"all"|"num"|"str"|!Function} filter
   * @param args
   * @returns {!DataFrame} data frame with f applied to colId
   */
  call(colId = null, f, filter = 'all', ...args) {
    if (colId === null) {
      log.info('colId not specified');
      if (this.nCols === 1) {
        log.info('running for the only col');
      } else {
        log.info('running for all cols');
      }
    }
    if (filter === 'num') {
      log.info('ignoring str cols');
      return this.call(colId, f, cIdx => this._numColIdxs.has(cIdx), ...args);
    } else if (filter === 'str') {
      log.info('ignoring num cols');
      return this.call(colId, f, cIdx => !this._numColIdxs.has(cIdx), ...args);
    } else if (filter === 'all') {
      return this.call(colId, f, cIdx => true, ...args);
    }
    const cols = Array.from(this._cols);
    const colIdxs = (colId === null ? this.colNames : [colId]).map(id => this.colIdx(id));
    if (f.constructor.name === 'String') {
      for (const cIdx of colIdxs) {
        if (!filter(cIdx)) {
          log.debug(`tried running op col #${cIdx}`);
        } else {
          if (cols[cIdx][f] === undefined) {
            throw new Error(`can't call ${f} on column ${this.colNames[cIdx]}`);
          }
          cols[cIdx] = cols[cIdx][f](...args);
        }
      }
    } else {
      for (const cIdx of colIdxs) {
        if (!filter(cIdx)) {
          log.debug(`tried running op col #${cIdx}`);
        } else {
          cols[cIdx] = f(cols[cIdx], ...args);
        }
      }
    }
    return new DataFrame(cols, 'cols', Array.from(this.colNames));
  }

  /**
   * @param {!Function|!String} [f]
   * @param {"all"|"num"|"str"|!Function} filter
   * @param args
   * @returns {!DataFrame} data frame
   */
  agg(f = xs => xs.length, filter = 'all', ...args) {
    const numCols = this._numColIdxs;
    if (filter === 'num') {
      return this.agg(f, cIdx => numCols.has(cIdx), ...args);
    } else if (filter === 'str') {
      return this.agg(f, cIdx => !numCols.has(cIdx), ...args);
    } else if (filter === 'all') {
      return this.agg(f, cIdx => true, ...args);
    }
    const colNames = [];
    const aggResults = [];
    if (f.constructor.name === 'String') {
      for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
        if (!filter(cIdx)) {
          continue;
        }
        const col = this._cols[cIdx];
        const colName = this.colNames[cIdx];
        colNames.push(colName);
        aggResults.push(col[f]());
      }
    } else {
      for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
        if (!filter(cIdx)) {
          continue;
        }
        const col = this._cols[cIdx];
        const colName = this.colNames[cIdx];
        colNames.push(colName);
        aggResults.push(f(col));
      }
    }
    return new DataFrame([colNames, aggResults],
      'cols',
      ['column', f.constructor.name === 'String' ? f : 'agg']);
  }

  /**
   * @param {!Array<!String>|!Array<!Number>|TypedArray} col
   * @param {?String} [name]
   * @returns {!DataFrame} data frame
   */
  appendCol(col, name = null) {
    const colNames = Array.from(this.colNames);
    const cols = Array.from(this._cols);
    cols.push(col);
    if (name === null) {
      colNames.push(colNames.length);
    } else {
      colNames.push(name);
    }
    return new DataFrame(cols, 'cols', colNames);
  }

  /**
   * @param {!DataFrame} other
   * @param {'col'|'row'|'cols'|'rows'|0|1} [axis]
   * @returns {!DataFrame} data frame
   */
  concat(other, axis = 0) {
    if (axis.constructor.name === 'Number') {
      if (axis < 0) {
        return this.concat(other, axis + 2);
      } else if (axis === 0) {
        const cols = Array.from(this._cols);
        for (let c = 0; c < this.nCols; c++) {
          const myCol = cols[c];
          const otherCol = other._cols[c];
          cols[c] = myCol.concat(otherCol);
        }
        return new DataFrame(cols, 'cols', Array.from(this.colNames));
      }
    } else if (axis.constructor.name === 'String') {
      if (axis.match(/^col/i)) {
        return this.concat(other, 0);
      } else {
        return this.concat(other, 1);
      }
    }

    // else if concat HORIZONTALLY {
    const isDigit = /^\d+$/; // check if has proper column names or just indexes
    let colNames;

    // if columns are indexes, shift them
    if (other.colNames.filter(c => c.toString().match(isDigit)).length === other.colNames.length) {
      colNames = this.colNames.concat(other.colNames.map(cIdx => this.colNames.length + cIdx));
    } else {
      colNames = this.colNames.concat(other.colNames);
    }

    let renamed;

    /*
     * deal with duplicate col names (add a num to the -- e.g.: Age, Salary, Age2 ...)
     * make sure that name clash didn't arise as a result of previous renaming {
     */
    do {
      renamed = false; // clear
      for (let cIdx = 0; cIdx < colNames.length; cIdx++) {
        const name = colNames[cIdx];
        let count = 2;
        for (let ptr = cIdx + 1; ptr < colNames.length; ptr++) {
          const name2 = colNames[ptr];
          if (name === name2) {
            colNames[ptr] += count.toString();
            renamed = true;
            count++;
          }
        }
      }
    } while (renamed);

    const cols = this._cols.concat(other._cols);
    return new DataFrame(cols, 'cols', colNames);
  }

  /**
   * @param {...!Number} idxs PAIRS of indexes
   * @returns {!DataFrame} a data frame
   */
  slice(...idxs) {
    if (idxs.length === 0) {
      throw new Error('you need to specify indexes (e.g. df.slice(0, 10), df.slice(-20, -10))');
    } else if (idxs.length % 2 !== 0) {
      idxs.push(this.length); // odd number of idxs
      /*
       * e.g. slice(0)         -> slice(0, end)
       * e.g. slice(0, 10, 20) -> slice(0, 10, 20, end)
       */
    } else if (idxs.some(idx => idx < 0)) {
      // resolve negative indexes
      return this.slice(...(idxs.map(idx => (idx < 0 ? idx + this.length : idx))));
    }

    const cols = Array(this.nCols).fill(0);

    // for every pair of indexes
    for (let i = 1; i < idxs.length; i += 2) {
      const lBound = idxs[i - 1];
      const rBound = idxs[i];
      for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
        const col = this._cols[cIdx];
        cols[cIdx] = col.subarray(lBound, rBound);
      }
    }

    return new DataFrame(cols, 'cols', Array.from(this.colNames));
  }

  /**
   * E.g. sliceCols(0)         -> sliceCols(0, end).
   * E.g. sliceCols(0, 10, 20) -> sliceCols(0, 10, 20, end).
   *
   * @param cols col pairs
   * @returns {!DataFrame} data frame
   */
  sliceCols(...slices) {
    if (slices.length === 0) {
      throw new Error('no slice idxs specified (e.g. df.sliceCols(0, -1))');
    } else if (slices.length % 2 !== 0) {
      // odd number of idxs
      return this.sliceCols(...slices, this.nCols - 1);
    }

    // collect column idxs
    const colIds = new Set();

    for (let i = 1; i < slices.length; i += 2) {
      const lBound = this.colIdx(slices[i - 1]);
      const rBound = this.colIdx(slices[i]);
      for (let cIdx = lBound; cIdx <= rBound; cIdx++) {
        colIds.add(cIdx);
      }
    }

    // then select them
    return this.select(...colIds);
  }

  /**
   * @param colIds
   * @return {!DataFrame} data frame
   */
  drop(...colIds) {
    if (colIds.length === 0) {
      throw new Error('you need to select a column (e.g. df.drop(0, -2, -4))');
    }
    const toDelete = new Set(colIds.map(id => this.colIdx(id)));
    const neededCols = this.colNames
      .map((_, idx) => idx)
      .filter(cIdx => !toDelete.has(cIdx));

    return this.select(...neededCols);
  }

  /**
   * @param {!Function} f
   * @param {?String|?Number} [colId]
   * @returns {!DataFrame} data frame
   */
  filter(f = (_row, _idx) => true, colId = null) {
    if (colId === null) {
      const rows = [];
      for (const r of this.rowsIter) {
        if (f(r)) rows.push(r);
      }
      return new DataFrame(rows, 'rows', Array.from(this.colNames));
    }
    // else focus on one column
    const col = this.col(colId);
    const tests = Array(col.length).fill(false);
    for (let i = 0; i < col.length; i++) {
      tests[i] = f(col[i]);
    }
    const cols = Array.from(this._cols);
    for (let i = 0; i < this.nCols; i++) {
      cols[i] = cols[i].filter((_, idx) => tests[idx]);
    }
    return new DataFrame(cols, 'cols', Array.from(this.colNames));
  }

  /**
   * @param {!String|!Number} colId
   * @param {!String|!Number} val
   * @param {">"|">="|"<"|"<="|"="} op
   * @returns {!DataFrame} data frame
   */
  where(val = null, colId = null, op = '=') {
    if (colId === null) {
      if (this.nCols === 1) {
        return this.where(val, 0, op);
      } else {
        throw new Error('no columns specified');
      }
    }
    if (op === '=') {
      return this.filter(x => x === val, colId);
    } else if (op === '>') {
      return this.filter(x => x > val, colId);
    } else if (op === '<') {
      return this.filter(x => x < val, colId);
    } else if (op === '<=') {
      return this.filter(x => x <= val, colId);
    } else if (op === '>=') {
      return this.filter(x => x >= val, colId);
    } else {
      throw new Error(`unrecognised op ${op}`);
    }
  }

  /**
   * @param {*} val
   * @param colIds
   * @returns {!DataFrame} data frame without val in colIds
   */
  removeAll(val, ...colIds) {
    const tests = Array(this.length).fill(true);

    if (colIds.length === 0) {
      if (this.nCols === 0) {
        throw new Error('no columns to delete');
      } else {
        return this.removeAll(val, ...this.colNames);
      }
    }

    const colIdxs = colIds.map(id => this.colIdx(id));

    for (let i = 0; i < this.length; i++) {
      for (const cIdx of colIdxs) {
        const col = this._cols[cIdx];
        if (Object.is(col[i], val)) {
          tests[i] = false;
          break;
        }
      }
    }

    const cols = Array.from(this._cols);

    for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
      cols[cIdx] = cols[cIdx].filter((_, idx) => tests[idx]);
    }

    return new DataFrame(cols, 'cols', Array.from(this.colNames));
  }

  /**
   * @param colIds
   * @returns {!DataFrame} data frame
   */
  dropOutliers(...colIds) {
    // by default compute for all (numeric) columns
    if (colIds.length === 0) {
      log.info('running dropOutliers for all cols');
      return this.dropOutliers(...this.colNames);
    }

    const cols = Array.from(this._cols);
    const numCols = this._numColIdxs;

    // indexes of *NUMERIC* columns
    const numColIdxs = new Set(colIds.map(id => this.colIdx(id)).filter(cIdx => numCols.has(cIdx)));

    // store {Q1, Q3, idx} for every *NUMERIC* column
    const IQRs = this.colNames
    // get column indexes
      .map((_, idx) => idx)
    // and now get all NUMERIC columns while leaving gaps to preserve indexing
      .map(idx => (numColIdxs.has(idx) ? this._cols[idx] : null))
    // and now computer IQ1 and IQ3 for all NUMERIC columns while leaving gaps to preserve indexing
      .map(maybeCol => (maybeCol === null ? null : ({ Q1: maybeCol.Q1(), Q3: maybeCol.Q3() })));

    // store results of testing for all rows
    const tests = Array(this.length).fill(true);

    // see if this row is an outlier by looking at each numeric column
    for (let rIdx = 0; rIdx < this.length; rIdx++) {
      for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
        if (!numColIdxs.has(cIdx)) continue;
        const col = cols[cIdx];
        const val = col[rIdx];
        // if value is in Q1 .. Q3 then accept
        if (val < IQRs[cIdx].Q1 || val > IQRs[cIdx].Q3) {
          tests[rIdx] = false;
          break;
        }
      }
    }

    for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
      // filter every col according to pre-computed boolean vals above
      cols[cIdx] = cols[cIdx].filter((_, rIdx) => tests[rIdx]);
    }

    return new DataFrame(cols, 'cols', Array.from(this.colNames));
  }

  /**
   * @param {!Number|!String} colId
   * @param {'asc'|'des'|!Function} [ord]
   * @returns {DataFrame}
   */
  sort(colId = null, ord = 'asc') {
    if (colId === null) {
      if (this.nCols === 1) {
        return this.sort(0, ord);
      } else {
        throw new Error('you need to select a column (e.g. df.sort(0))');
      }
    }
    const cIdx = this.colIdx(colId);
    if (ord.constructor.name === 'Function') {
      return new DataFrame(Array.from(this.rowsIter).sort(ord), 'rows', Array.from(this.colNames));
    } else if (ord === 'asc') {
      return this.sort(cIdx, (r1, r2) => (r1[cIdx] > r2[cIdx] ? 1 : r1[cIdx] < r2[cIdx] ? -1 : 0));
    } else {
      return this.sort(cIdx, (r1, r2) => (r1[cIdx] > r2[cIdx] ? -1 : r1[cIdx] < r2[cIdx] ? 1 : 0));
    }
  }

  /**
   * Shuffle the data frame.
   *
   * @returns {!DataFrame} data frame with shuffle rows
   */
  shuffle() {
    const rows = Series.from(Array.from(this.rowsIter)).shuffle();
    return new DataFrame(rows, 'rows', Array.from(this.colNames));
  }

  /**
   * @param {"f32"|"f64"|"i8"|"16"|"i32"|"u8"|"u16"|"u32"|"s"|null} [dtype]
   * @param {?Array<!Number|!String>} [colNames]
   */
  transpose(dtype = null, colNames = null) {
    if (dtype === null) {
      const dt = this.dtypes.reduce((dt1, dt2) => unify(dt1, dt2));
      log.info(`inferred dtype = ${dt}`);
      return this.transpose(dt, colNames);
    }
    log.info('transpose is expensive');
    const cols = Array(this.length).fill(0).map(_ => Series.empty(this.nCols, dtype));
    for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
      for (let rIdx = 0; rIdx < this.length; rIdx++) {
        cols[rIdx][cIdx] = this._cols[cIdx][rIdx];
      }
    }
    return new DataFrame(cols, 'cols', colNames);
  }

  /**
   * @returns {!DataFrame} a correlation matrix
   */
  corr(withNames = true) {
    const numCols = this._numColIdxs;
    const colIdxs = [];
    const rows = [];
    const cache = {};
    for (let yIdx = 0; yIdx < this.nCols; yIdx++) {
      if (!numCols.has(yIdx)) {
        log.debug(`skipped correlating str col #${yIdx}`);
        continue;
      }
      // else
      colIdxs.push(yIdx);
      rows.push([]);
      for (let xIdx = 0; xIdx < this.nCols; xIdx++) {
        // every col is perfectrly correlated with itself (save some computation time)
        if (xIdx === yIdx) {
          log.debug('corr with self = 1, skipping');
          rows[rows.length - 1].push(1);
          continue;
        } 

        if (!numCols.has(xIdx)) {
          log.debug(`skipped correlating str col #${xIdx}`);
          continue;
        }

        // else if numeric
        let corr = cache[`${yIdx}:${xIdx}`];

        if (corr === undefined) {
          corr = cache[`${xIdx}:${yIdx}`];
        }

        if (corr === undefined) {
          const col = this._cols[yIdx];
          const other = this._cols[xIdx];
          corr = col.corr(other);
          cache[`${yIdx}:${xIdx}`] = corr;
          log.debug(`computed and cached corr(col #${xIdx}, col #${yIdx})`);
        } else {
          log.debug(`found corr(col #${xIdx}, col #${yIdx}) in cache`);
        }

        rows[rows.length - 1].push(corr);
      }
    }

    // numeric col names in the order of appearing in the matrix
    const colNames = this.colNames.filter((_, cIdx) => colIdxs.indexOf(cIdx) >= 0);

    /*
     * prepend a col with colum names to the left
     *    A1 A2 A3
     * A1
     * A2
     * A3
     */
    if (withNames) {
      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        const colName = this.colNames[colIdxs[rIdx]];
        const row = rows[rIdx];
        rows[rIdx] = [colName].concat(row);
      }
      return new DataFrame(rows, 'rows', ['column'].concat(colNames));
    }
    // else
    return new DataFrame(rows, 'rows', colNames);
  }

  /**
   * @param {!Number} [n] number of cols to select
   * @param {"var"|"stdev"|"mean"|"mad"|"IQR"|"median"|"Q1"|"Q3"|"skewness"|"min"|"range"|"max"|!Function} [agg]
   * @returns {!DataFrame} data frame
   */
  nBest(n = 5, agg = 'var') {
    if (n > this.nCols) {
      log.warn(`n = ${n}, but there is ${this.nCols} cols`);
      return this.nBest(this.nCols, agg);
    }

    let bestCols;

    if (agg.constructor.name === 'Function') {
      bestCols = this._cols.map((col, idx) => ({ idx, name: this.colNames[idx], score: agg(col) }));
    } else {
      bestCols = this._cols.map((col, idx) => ({ idx, name: this.colNames[idx], score: col[agg]() }));
    }

    bestCols = bestCols.sort((o1, o2) => (o1.score > o2.score ? -1 : o1.score < o2.score ? 1 : 0)).slice(0, n);

    if (bestCols.some(({ name }) => !name.toString().match(/\d+/))) {
      const colNames = [];
      const cols = [];
      for (const o of bestCols) {
        colNames.push(o.name);
        cols.push(this._cols[o.idx]);
      }
      return new DataFrame(cols, 'cols', colNames);
    } else {
      return new DataFrame(bestCols.map(({ idx }) => this._cols[idx]), 'cols');
    }
  }

  /**
   * @param {!Number} n ratio or number of elements
   * @param {?Boolean} wr with replacement
   * @returns {!DataFrame} data frame
   */
  sample(n = 0.1, wr = true) {
    // tODO optimize DF.sample(n, wr)
    if (n < 1) {
      return this.sample(Math.floor(n * this.length));
    } else if (n >= this.length) {
      log.warn('sample size >= nRows');
      return this.sample(this.length - 1, wr);
    }
    const rows = [];
    if (wr) {
      while (rows.length < n) {
        const rIdx = randInt(0, this.length);
        rows.push(this.row(rIdx));
      }
    } else {
      const idxs = Array(this.length).fill(0).map((_, idx) => idx);
      while (rows.length < n) {
        // this is a bit confusing because you are indexing an index
        const i = randInt(0, idxs.length);
        const rowIdx = idxs[i];
        const row = this.row(rowIdx);
        rows.push(row);
        idxs.pop(i); // remove i from possible idxs
      }
    }
    return new DataFrame(rows, 'rows', Array.from(this.colNames));
  }

  /**
   * Produce a count table for values of a column.
   *
   * @param {!String|!Number} colId
   * @returns {!DataFrame} data frame of counts
   */
  counts(colId = null) {
    if (colId === null) {
      // only 1 column so unambiguous
      if (this.nCols === 1) {
        log.info('colId not specified for counts, but because there is only 1 col');
        return this.count(0);
      } else {
        throw new Error('you need to select a column (e.g. `df.counts(0)`)');
      }
    }
    const cIdx = this.colIdx(colId);
    const col = this._cols[cIdx];
    const colNames = [this.colNames[cIdx], 'count'];
    return new DataFrame(col.counts(), 'map', colNames);
  }

  /**
   * One hot encode a column.
   *
   * @param {!String|!Number} colId
   * @returns {!DataFrame} one hot encoded table
   */
  oneHot(colId = null) {
    if (colId === null) {
      if (this.nCols === 1) {
        log.info('colId not specified for oneHot, but because there is only 1 col');
        return this.oneHot(0);
      } else {
        throw new Error('you need to select a column (e.g. `df.oneHot(0)`)');
      }
    }
    const col = this.col(colId);
    const k = col.max() + 1;
    const cols = Array(k)
      .fill(0)
      .map(_ => Series.empty(col.length, 'u8'));
    for (let rowIdx = 0; rowIdx < col.length; rowIdx++) {
      const val = col[rowIdx];
      cols[val][rowIdx] = 1;
    }
    return new DataFrame(cols, 'cols');
  }

  /**
   * Summaries each column.
   *
   * @returns {DataFrame} data frame
   */
  summary() {
    const info = {
      column: Series.from([]),
      dtype: Series.from([]),
      min: Series.empty(this.nCols),
      max: Series.empty(this.nCols),
      range: Series.empty(this.nCols),
      mean: Series.empty(this.nCols),
      stdev: Series.empty(this.nCols),
    };

    const numCols = this._numColIdxs;

    for (let c = 0; c < this.nCols; c++) {
      info.column.push(this.colNames[c]);
      info.dtype.push(this.dtypes[c]);

      if (numCols.has(c)) {
        const col = this._cols[c];
        info.min[c] = col.min();
        info.max[c] = col.max();
        info.range[c] = info.max[c] - info.min[c];
        info.mean[c] = col.mean();
        info.stdev[c] = col.stdev();
      } else {
        for (const k of [
          'min', 'max', 'range', 'mean', 'stdev',
        ]) {
          info[k][c] = NaN;
        }
      }
    }
    return new DataFrame(info);
  }

  /**
   * @returns {!DataFrame} shallow copy of the data frame
   */
  copy() {
    return new DataFrame(Array.from(this._cols), 'cols', Array.from(this.colNames));
  }

  /**
   * @returns {!DataFrame} clone (deep copy) of the data frame
   */
  clone() {
    const newCols = [];
    for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
      const col = this._cols[cIdx];
      newCols.push(col.clone());
    }
    return new DataFrame(newCols, 'cols', Array.from(this.colNames));
  }

  /**
   * @returns {!Object<Array<!Number>|!Array<!String>>} dictionary
   * @private
   */
  _toObj() {
    const dict = {};
    for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
      const cName = this.colNames[cIdx];
      const col = this._cols[cIdx];
      dict[cName] = Array.from(col);
    }
    return dict;
  }

  /**
   * @returns {!String} json-stringified data frame
   */
  toJSON() {
    return JSON.stringify(this._toObj());
  }

  /**
   * @param {!String} filePath
   * @param {!Boolean|!Array<!String|!Number>} [header]
   * @returns {!DataFrame} data frame
   */
  toCSV(filePath) {
    // tODO DataFrame.toCSV()
    throw new Error('not implemented yet');
  }

  /**
   * @returns {!String} HTML
   */
  toHTML() {
    const chunks = [];

    chunks.push('<table>');
    chunks.push('<tr>');

    for (const name of this.colNames) {
      chunks.push('<th>');
      chunks.push(name.toString());
      chunks.push('</th>');
    }

    chunks.push('</tr>');

    for (let rIdx = 0; rIdx < this.length; rIdx++) {
      chunks.push('<tr>');

      for (const val of this.irow(rIdx)) {
        chunks.push(`<td>${val.toString()}</td>`);
      }

      chunks.push('</tr>');
    }

    chunks.push('</table>');
    return chunks.join('');
  }

  /**
   * @param {!String} filePath
   */
  saveJSON(filePath) {
    if (!filePath.match(/\.json$/i)) {
      log.warn(`bad file name ${filePath}, expected *.json file name`);
    }
    const out = createWriteStream(filePath);
    out.end(JSON.stringify(this._toObj()));
    log.info(`saved JSON to ${filePath}`);
  }

  /**
   * @param {!String} filePath
   */
  saveHTML(filePath) {
    if (filePath.match(/\.x?html\d?$/i)) {
      const out = createWriteStream(filePath);

      out.write('<table>');
      out.write('<tr>');

      for (const name of this.colNames) {
        out.write(`<th>${name.toString()}</th>`);
      }

      out.write('</tr>');

      for (let rIdx = 0; rIdx < this.length; rIdx++) {
        out.write('<tr>');

        for (const val of this.irow(rIdx)) {
          out.write('<td>');
          out.write(val.toString());
          out.write('</td>');
        }

        out.write('</tr>');
      }

      out.end('</table>');
      log.info(`saved HTML to ${filePath}`);
    } else {
      throw new Error('bad file name, expected *.html file name');
    }
  }

  /**
   * @param {!String} filePath
   */
  saveCSV(filePath) {
    if (filePath.match(/\.csv$/i)) {
      const stringifier = stringifyCSV();
      const out = createWriteStream(filePath);
      const header = this.colNames.map(cName => cName.toString());

      stringifier.on('error', err => log.error(err.message));

      stringifier.on('data', row => out.write(row));

      stringifier.write(header);

      for (const r of this.rowsIter) {
        stringifier.write(r);
      }
      log.info(`saved CSV to ${filePath}`);
    } else {
      throw new Error(`bad file name, expected *.csv file name`);
    }
  }

  /**
   * @param {!String} filePath
   * @param {!Boolean|!Array<!String|!Number>} [header]
   * @returns {!DataFrame} data frame
   */
  static loadCSV(filePath, header = true) {
    if (!filePath.endsWith('.csv')) {
      log.warn('not a *.csv file');
    }
    const rows = readCSV(filePath);
    if (header === true) {
      return new DataFrame(rows.splice(1), 'rows', rows[0]);
    } else if (header === false) {
      return new DataFrame(rows, 'rows');
    } else {
      return new DataFrame(rows, 'rows', header);
    }
  }

  /**
   * Loads JSON-encoded data.
   *
   * NOTE the format must be the same as returned by saveJSON. Ie. { colName: [...], ...}.
   *
   * @param {!String} filePath
   * @returns {!DataFrame} data frame
   */
  static loadJSON(filePath) {
    const dict = readFileSync(filePath);
    return new DataFrame(JSON.parse(dict));
  }

  /**
   * Loads one of the toy datasets the library ships whith.
   *
   * NOTE to see all availible datasets run `DataFrame.dataSets`.
   *
   * @param {!String} name
   * @param {?Boolean} hasHeader
   * @param {?Array<!String>} colNames
   * @returns {!DataFrame} data frame
   */
  static loadDataSet(name, hasHeader = true, colNames = null) {
    return DataFrame.loadCSV(`${dirname(__filename)}/datasets/${name}/${name}.csv`, hasHeader, colNames);
  }

  /**
   * Toy datasets path.
   *
   * @returns {!String} datasets path
   * @private
   */
  static get _dataSetsPath() {
    return join(dirname(__filename), 'datasets');
  }

  /**
   * @returns {!Array<!String>} datasets
   */
  static get dataSets() {
    return readdirSync(DataFrame._dataSetsPath).filter(node => !node.match(/\.w+$/));
  }

  /**
   * Construct a DataFrame from columns.
   *
   * @param cols columns
   * @returns {!DataFrame}
   */
  static of(...cols) {
    return new DataFrame(cols, 'cols');
  }

  /**
   * Sets an option.
   *
   * @param {!String} k
   * @param {*} v
   */
  static get opts() {
    return env;
  }

  /**
   * @param {?Number} [n]
   * @param {?Number} [m]
   */
  print(n = null, m = null) {
    console.log(this.toString(n, m));
  }

  [util.inspect.custom](depth, options) {
    return this.toString();
  }

  /**
   * @returns {!String} string representation of the data frame
   */
  toString(n = null, m = null) {
    if (n === null) {
      const newN = Math.min(this.length, process.stdout.rows - 12);
      return this.toString(newN);
    } else if (m === null) {
      return this.toString(0, n);
    } else if (n < 0) {
      return this.toString(n + this.length, m);
    } else if (m < 0) {
      return this.toString(n, m + this.length);
    } else if (n > this.length) {
      log.warn(`n = ${n}, but there is ${this.length} rows`);
      return this.toString(this.length - n, this.length);
    } else if (m > this.length) {
      log.warn(`m = ${m}, but there is ${this.length} rows`);
      return this.toString(Math.max(0, this.length - (m - n)), this.length);
    } else if (this.nCols === 0) {
      return 'Empty DataFrame';
    }

    let colWidth = Math.max(
      // 1 for ' ' between cols
      Math.floor(process.stdout.columns / this.nCols),
      env.MIN_COL_WIDTH);

    // few cols so make them larger
    if (this.nCols <= 1) {
      colWidth += 15;
    } else if (this.nCols <= 2) {
      colWidth += 10;
    } else if (this.nCols <= 3) {
      colWidth += 7;
    } else if (this.nCols <= 4) {
      colWidth += 3;
    } else if (this.nCols <= 5) {
      colWidth += 1;
    }

    const rows = [];

    // index marker
    const headerRow = ['#'];

    for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
      let h = this.colNames[cIdx].toString(); 
      // trunc column headings
      if (h.length > colWidth) {
        h = `${h.slice(0, colWidth - 2)}..`;
      } 
      // pad to reserve space for ' ' and dtype (injected later after col len is computed)
      h =  ' '.repeat(this.dtypes[cIdx].length + 1) + h.toString();
      headerRow.push(h);
    }

    rows.push(headerRow);

    const midCol = Math.floor(rows[0].length / 2);

    if (n > 0) {
      const arr = Array(this.nCols + 1).fill('...');
      arr[midCol] = `(${n} more)`;
      rows.push(arr);
    }

    const numCols = this._numColIdxs;

    for (let rIdx = n; rIdx < m; rIdx++) {
      const row = Array(this.nCols + 1).fill(0);
      row[0] = rIdx.toString();
      for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
        const val = this.val(rIdx, cIdx);
        const s = val.toString();
        const isNum = numCols.has(cIdx);
        const isStr = !isNum && val.constructor.name === 'String';
        const isTooLong = isStr && s.length > colWidth;

        if (isTooLong) {
          row[cIdx + 1] = `${s.slice(0, colWidth - 2)}..`;
          continue;
        }

        const isFloat = isNum && this.dtypes[cIdx].startsWith('f');

        if (isFloat) {
          row[cIdx + 1] = fmtFloat(val, env.PRINT_PREC);
          continue;
        }

        row[cIdx + 1] = s;
      }
      rows.push(row);
    }

    if (this.length === 0) {
      const emptyInfo = Array(this.nCols + 1).fill('empty');
      emptyInfo[0] = '';
      rows.push(emptyInfo);

    } else if (m < this.length) {
      const arr = Array(this.nCols + 1).fill('...');
      arr[midCol] = `(${this.length - m} more)`;
      rows.push(arr);
    }

    const memInfo = Array(this.nCols + 1).fill(0);
    memInfo[0] = '';
    
    for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
      const col = this._cols[cIdx];
      // string column
      if (col.memory === undefined) {
        memInfo[cIdx + 1] = '';
      } else {
        memInfo[cIdx + 1] = fmtFloatSI(col.memory(), env.PRINT_PREC, 'B').replace('.00', '');
      }
    }

    rows.push(memInfo);

    // lengths of each column
    const colWidths = Array(this.nCols + 1)
      .fill(0)
      .map((_, idx) => rows
        .map(r => r[idx].toString().length)
        .reduce((x, y) => Math.max(x, y), 1)
      );

    // underline
    rows.splice(1, 0, colWidths.map(l => '-'.repeat(l)));
    rows.splice(rows.length - 1, 0, colWidths.map(l => '-'.repeat(l)));

    // inject dtypes for all headings
    const headerRowWithDT = Array(headerRow.length);
    headerRowWithDT[0] = headerRow[0];

    for (let cIdx = 0; cIdx < this.nCols; cIdx++) {
      const len = colWidths[cIdx + 1];
      const h = headerRow[cIdx + 1];
      const dtype = this.dtypes[cIdx];
      const heading = h.trim();
      headerRowWithDT[cIdx + 1] = `${dtype}${' '.repeat(len - heading.length - dtype.length)}${heading}`;
    }

    rows[0] = headerRowWithDT;

    // +1 for space between cols
    const tooLong = colWidths.reduce((l1, l2) => l1 + l2 + 1, 0) > process.stdout.columns;

    if (tooLong) {
      // remove cols in the middle
      // +1 for ' ' padding
      const nColsToShow = Math.floor(process.stdout.columns / (colWidth + 1)); 
      // C C C LEFT C C C RIGHT C C C
      // should remove Cs on the left of LEFT and on the right of RIGHT
      // C C C ... C C C
      const left = Math.floor(nColsToShow / 2);
      const right = rows[0].length - left;
      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        let s = '';
        for (let cIdx = 0; cIdx < left; cIdx++) {
          s += rows[rIdx][cIdx].padStart(colWidths[cIdx] + 1, ' ');
        }
        s += ' ...';
        for (let cIdx = right; cIdx < rows[rIdx].length; cIdx++) {
          s += rows[rIdx][cIdx].padStart(colWidths[cIdx] + 1, ' ');
        }
        rows[rIdx] = s;
      }
    } else {
      // pad start with ' '
      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        rows[rIdx] = rows[rIdx].map((val, cIdx) => val.padStart(colWidths[cIdx] + 1, ' ')).join(' ');
      }
    }
    return rows.join('\n');
  }
}

module.exports = DataFrame;
