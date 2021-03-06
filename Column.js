/* eslint-disable no-nested-ternary,max-lines,no-magic-numbers,complexity */

/**
 * @module
 */
/* eslint-disable sort-keys,no-param-reassign */
const util = require('util');

const { randInRange, randInt } = require('./rand');
const { dtypeRegex, isNumRegex, fmtFloat, isNumber, isString } = require('./utils');
const log = require('./log');
const opts = require('./opts');

/**
 * @typedef {'i8'|'i16'|'i32'|'u8'|'u16'|'u32'|'f32'|'f64'} DType
 * @typedef {Uint8Array|Uint8ClampedArray|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array} TypedArray
 */

/**
 * @typedef {ArrayLike<number>|ArrayLike<string>} Col
 * @property {boolean} isEmpty
 * @property {boolean} randEl
 * @property {number} BYTES_PER_ELEMENT
 * @property {function(fun): boolean} all
 * @property {function(*): number} argMax
 * @property {function(*): number} argMin
 * @property {function(*): boolean} contains
 * @property {function(): *} counts
 * @property {function(): *} cum
 * @property {function(): *} filter
 * @property {function(): *} map
 * @property {function(): *} mode
 * @property {function(): *} none
 * @property {function(function(any): boolean): boolean} some
 * @property {function(number): number} tail
 * @property {function(function(any): Boolean): Col} filter
 * @property {function(): *} print
 * @property {function(): *} ps
 * @property {function(number): number} head
 * @property {function(?DType): Col} clone
 * @property {function(): *} reduce
 * @property {function(): *} subarray
 * @property {function(): *} removeAll
 * @property {function(): *} unique
 * @property {function(): *} reverse
 * @property {function(): *} shuffle
 * @property {function(): *} slice
 * @property {function(): *} sort
 * @property {function(): *} swap
 * @property {function(): *} takeWhile
 * @property {function(): *} zipWith
 * @property {function(): *} zipWith3
 * @property {function(): *} toString
 * @property {string} dtype
 * @property {number} length
 */

/**
 * @typedef {Col} ColStr
 * @property {'s'} dtype
 * @property {string} randEl
 * @property {function(ColStr): ColStr} concat
 * @property {function(string, string): ColStr} replace
 * @property {function(): string} pop
 * @property {function(): *} labelEncode
 * @property {function(number): ColStr} sample
 */

/**
 * @typedef {Col} ColNum
 * @property {DType} dtype
 * @property {number} randEl
 * @property {function(): number} IQR
 * @property {function(): number} Q1
 * @property {function(): number} Q3
 * @property {function(): number} abs
 * @property {function((number|ColNum|undefined)): number} add
 * @property {function(): number} cbrt
 * @property {function(): number} ceil
 * @property {function(): number} clip
 * @property {function(ColNum): ColNum} concat
 * @property {function(): number} corr
 * @property {function(): number} cov
 * @property {function(): number} cube
 * @property {function(): number} disDiff
 * @property {function(): number} pop
 * @property {function(number): number} distance
 * @property {function(?DType): ColNum} convert
 * @property {function((number|ColNum|undefined)): number} div
 * @property {function(): number} dot
 * @property {function(): number} downcast
 * @property {function(): number} floor
 * @property {function(number): number} kBins
 * @property {function(): number} kurtosis
 * @property {function(): number} mad
 * @property {function(): number} map
 * @property {function(): number} max
 * @property {function(): number} mean
 * @property {function(): number} median
 * @property {function(): number} memory
 * @property {function(): number} min
 * @property {function((number|ColNum|undefined)): number} mul
 * @property {function(): number} nLargest
 * @property {function(): number} nQuart
 * @property {function(): number} nSmallest
 * @property {function(): number} normalize
 * @property {function(): number} pow
 * @property {function(): number} removeOutliers
 * @property {function(number, number): ColStr} replace
 * @property {function(): number} root
 * @property {function(): number} round
 * @property {function(): number} sample
 * @property {function(): number} skewness
 * @property {function(): number} smooth
 * @property {function(): number} sqrt
 * @property {function(): number} square
 * @property {function(): number} stdev
 * @property {function((number|ColNum|undefined)): number} sub
 * @property {function(number, number): number} subarray
 * @property {function(function(number): boolean): number} takeWhile
 * @property {function(): number} trunc
 * @property {function(): number} var
 */

/**
 *
 * @param {Object} o
 * @param {string} name
 * @param {function(): *} f
 * @private
 */
const defineGetter = (o, name, f) => {
  Object.defineProperty(o, name, { get: f, configurable: true });
};

const COL_PROTO = {

  /**
   * @param {?DType} [dtype]
   * @returns {ColNum|ColStr}
   */
  clone(dtype = null) {
    const newArr = empty(this.length, dtype === null ? this.dtype : dtype);
    newArr.set(this);
    if (this.labelMap !== undefined) {
      newArr.labelMap = this.labelMap;
    }
    if (this.kBinsBounds !== undefined) {
      newArr.kBinsBounds = this.kBinsBounds;
    }
    return newArr;
  },

  /**
   * @param {?DType} [dtype]
   * @param {boolean} [doClone]
   * @returns {ColNum}
   */
  convert(dtype = null, doClone = true) {
    return from(this, dtype, doClone);
  },


  /**
   * @returns {number}
   */
  memory() { return this.BYTES_PER_ELEMENT * this.length; },

  /**
   * @param {?number} [n]
   * @returns {ColNum}
   */
  head(n = null) {
    return n === null
      ? this.head(opts.HEAD_LEN)
      : this.subarray(0, n);
  },

  /**
   * @param {?number} [n]
   * @returns {ColNum}
   */
  tail(n = null) {
    return n === null
      ? this.tail(opts.HEAD_LEN)
      : this.subarray(this.length - n);
  },

  /**
   * @param {function(*, number, ColNum): *} f
   * @param {?DType|'s'} [dtype]
   * @returns {ColNum}
   */
  map(f, dtype = null) {
    const xs = Array(this.length).fill(0);
    for (let i = 0; i < this.length; i++) {
      xs[i] = f(this[i], i, this);
    }
    return from(xs, dtype, false);
  },

  // printing

  /**
   * @param {?number} [len]
   * @returns {string}
   */
  toString(len = null) {
    if (len === null) {
      return this.toString(opts.HEAD_LEN);
    } else if (len > this.length) {
      log.warn(`len = ${len}, but there is ${this.length} items`);
      return this.toString(Math.min(len, this.length));
    }
    const parts = [`Col${this.dtype === undefined ? '' : this.dtype[0].toUpperCase()}${this.dtype !== undefined ? this.dtype.slice(1) : ''} [`];
    for (let i = 0; i < len; i++) {
      const val = this[i];
      const s = val.toString();
      const isFloat = isNumber(val) && s.indexOf('.') >= 0;
      parts.push(isFloat ? fmtFloat(val) : isString(val) ? `"${s}"` : s);
    }
    if (len < this.length) {
      parts.push(`... ${this.length - len} more`);
    }
    return `${parts[0] + parts.slice(1).join(', ')}]`;
  },

  /**
   * @param {?number} [n]
   */
  print(n = null) {
    if (n === null) {
      this.print(opts.HEAD_LEN);
    } else {
      console.log(this.toString(n));
    }
  },


  // cumulative operations

  /**
   * @param {function((ColNum|ColStr)): Col} f
   * @param {?DType} [dtype]
   * @returns {ColNum|ColStr}
   */
  cum(f, dtype = null) {
    return isString(f)
      ? this.cum((xs) => xs[f](), dtype)
      : this.map((x, idx, xs) => f(xs.subarray(0, idx + 1)), dtype);
  },

  // other

  /**
   * @param {function(*): boolean} f
   * @returns {ColNum|ColStr}
   */
  takeWhile(f) {
    let i = 0;
    while (f(this[i]) && i < this.length) i++;
    return this.slice(0, i);
  },

  /**
   * @param {function(*): boolean} f
   * @returns {ColNum|ColStr}
   */
  takeUntil(f) { return this.takeWhile((x) => !f(x)); },

  /**
   * @returns {Map<*, number>}
   */
  counts() {
    const b = new Map();
    for (const x of this) {
      b.set(x, (b.get(x) || 0) + 1);
    }
    return b;
  },

  /**
   * @returns {Map<*, number>}
   */
  ps() {
    const b = this.counts();
    let total = 0;
    for (const v of b.values()) {
      total += v;
    }
    const ps = new Map();
    for (const [k, v] of b.entries()) {
      ps.set(k, v / total);
    }
    return ps;
  },

  /**
   * @param {function(*): number} f
   * @returns {*}
   */
  argMax(f) {
    let best = this[0];
    let bestScore = f(best);
    for (let i = 1; i < this.length; i++) {
      const x = this[i];
      const score = f(x);
      if (score > bestScore) {
        bestScore = score;
        best = x;
      }
    }
    return best;
  },

  /**
   * @param {function(*): number} f
   * @returns {*}
   */
  argMin(f) {
    let best = this[0];
    let bestScore = f(best);
    for (let i = 1; i < this.length; i++) {
      const x = this[i];
      const score = f(x);
      if (score < bestScore) {
        bestScore = score;
        best = x;
      }
    }
    return best;
  },

  // pre-processing

  // boolean

  /**
   * @param {function(*): boolean} f
   * @returns {boolean}
   */
  all(f) { return !this.some((v) => !f(v)); },

  /**
   * @param {function(*): boolean} f
   * @returns {boolean}
   */
  none(f) { return !this.some((v) => f(v)); },

  /**
   * @param {*} v
   * @returns {boolean}
   */
  contains(v) { return this.indexOf(v) >= 0; },

  // manipulation

  /**
   * @param {?DType} [dtype]
   * @param {boolean} [inPlace]
   * @returns {ColStr|ColNum}
   */
  reverse(dtype = null, inPlace = false) {
    if (inPlace) {
      return this._reverse();
    } else {
      return this.clone(dtype).reverse(null, true);
    }
  },

  /**
   * @param {*} v
   * @returns {ColNum|ColStr}
   */
  removeAll(v) { return this.filter((a) => !Object.is(a, v)); },

  /**
   * @param {number} i
   * @param {number} j
   * @returns {ColStr|ColNum}
   */
  swap(i, j) {
    const save = this[i];
    this[i] = this[j];
    this[j] = save;
    return this;
  },

  /**
   * @param {'asc'|'des'|function(*, *): number} [order]
   * @param {?DType} [dtype]
   * @returns {ColNum|ColStr}
   */
  sort(order = 'asc', dtype = null, inPlace = false) {
    if (inPlace) {
      if (order === 'asc') {
        return this._sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
      } else if (order === 'des') {
        return this._sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
      } else {
        return this._sort(order);
      }
    }
    return this.clone(dtype).sort(order, null, true);
  },

  /**
   * @returns {ColStr|ColNum}
   * @private
   */
  _shuffle() {
    for (let i = this.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this[i], this[j]] = [this[j], this[i]];
    }
    return this;
  },

  /**
   * @param {?DType} [dtype]
   * @returns {ColStr|ColNum}
   */
  shuffle(dtype = null, inPlace = false) {
    if (inPlace) {
      return this._shuffle();
    } else {
      return this.clone(dtype).shuffle(null, true);
    }
  },

  /**
   * @returns {number|string|undefined}
   */
  mode() {
    if (this.length === 1) {
      return this[0];
    }
    const counts = [...this.counts()];

    if (counts.length === 1) {
      return counts[0][0];
    }

    return counts.reduce(([val1, count1], [val2, count2]) => count2 > count1
      ? [val2, count2]
      : [val1, count1])[0];
  },

  // functional programming

  /**
   * @param {Iterable<*>} other
   * @param {function(*, *): *} f
   * @param {?DType|'s'} [dtype]
   * @returns {ColNum|ColStr}
   */
  zipWith(other, f, dtype = null) {
    return this.map((x, idx) => f(x, other[idx]), dtype);
  },

  /**
   * @param {Iterable<*>} xs
   * @param {Iterable<*>} ys
   * @param {function(*, *, *): *} f
   * @param {?DType|'s'} [dtype]
   * @returns {ColNum|ColStr}
   */
  zipWith3(xs, ys, f, dtype = null) {
    return this.map((x, idx) => f(x, xs[idx], ys[idx]), dtype);
  },

  /**
   * @returns {ColNum|ColStr}
   */
  unique() {
    const s = new Set(this);
    const newArr = empty(this.length, this.dtype);
    let i = 0;
    for (const x of s) {
      newArr[i] = x;
      i++;
    }
    return newArr;
  },

  /**
   * @param {number} depth
   * @param {Object} options
   * @returns {string}
   */
  [util.inspect.custom](depth, options) {
    return this.toString(Math.min(this.length, opts.HEAD_LEN));
  },
};

/**
 * @param {Array<string>|TypedArray|ColStr|ColNum} a
 * @private
 */
const enh = function (a) {
  // already enhanced
  if (a.dtype !== undefined) {
    return;
  }

  // hacks necessary to ensure immutability
  a._slice = a.slice;
  a._filter = a.filter;
  a._sort = a.sort;
  a._reverse = a.reverse;

  defineGetter(a, 'randEl', function randEl() {
    return this[Math.floor(randInRange(0, this.length))];
  });

  defineGetter(a, 'isEmpty', function isEmpty() { return this.length === 0; });

  Object.assign(a, COL_PROTO);
};

const COL_STR_PROTO = {

  // memory & data type

  BYTES_PER_ELEMENT: 1,

  dtype: 's',

  /**
   * @param {ColStr} other
   * @param {number} [offset]
   */
  set(other, offset = 0) {
    for (let i = offset; i < this.length; i++) {
      this[i] = other[i - offset];
    }
  },

  // pre-processing

  /**
   * @param {RegExp|string} pat
   * @param {string} y
   * @param {boolean} [subStr]
   * @returns {ColStr}
   */
  replace(pat, y, subStr = false) {
    if (subStr) {
      return this.map((x) => x.replace(pat, y));
    } else if (isString(pat)) {
      return this.map((x) => x === pat ? y : x);
    } else {
      return this.map((x) => pat.test(x) ? y : x);
    }
  },

  /**
   * @param {?DType} [dtype]
   * @returns {ColNum}
   */
  labelEncode(dtype = 'u8') {
    const newArr = empty(this.length, dtype);
    const map = new Map();
    let label = 0;
    for (let i = 0; i < this.length; i++) {
      const val = this[i];
      const maybe = map.get(val);
      if (maybe === undefined) {
        map.set(val, label);
        newArr[i] = label;
        label++;
      } else {
        newArr[i] = maybe;
      }
    }
    newArr.labelMap = map;
    return newArr;
  },

  /**
   * @return {ColStr}
   */
  labelDecode() {
    return this.map((x) => this.labelMap.get(x));
  },

  // basic stats

  /**
   * @param {number} n
   * @param {boolean} [wr]
   * @returns {ColStr}
   */
  sample(n, wr = true) {
    if (n === null) {
      return this.sample(this.length, wr);
    }
    if (n < 1) {
      return this.sample(Math.floor(this.length * n), wr);
    }
    if (wr) {
      return from(Array(n).fill(0).map(() => this[randInt(0, this.length)]));
    }
    const sample = Array(n).fill(0);
    const used = new Set();
    for (let ptr = 0; ptr < n; ptr++) {
      let idx;
      do {
        idx = Math.floor(Math.random() * this.length);
      } while (used.has(idx));
      sample[ptr] = this[idx];
      used.add(idx);
    }
    return from(sample, this.dtype, false);
  },

  // manipulation, views and slices

  // functional programming

  // hacks

  /**
   * @param {ColStr} other
   * @returns {ColStr}
   */
  concat(other) {
    const xs = this._concat(other);
    enh(xs);
    enhStrArr(xs);
    return xs;
  },

  /**
   * @param {number} n
   * @param {number} m
   * @returns {ColStr}
   */
  slice(n, m) {
    const xs = this._slice(n, m);
    enh(xs);
    enhStrArr(xs);
    return xs;
  },


  /**
   * @param {function(*, number, ColStr): boolean} f
   * @returns {ColStr}
   */
  filter(f) {
    const xs = this._filter(f);
    enh(xs);
    enhStrArr(xs);
    return xs;
  },
};

/**
 * @param {Array<string>|ColStr} a
 * @private
 */
const enhStrArr = (a) => {
  // already enhanced
  if (a.dtype === 's') {
    return;
  }

  // hacks necessary to ensure immutability
  a._concat = a.concat;

  // consistency of API so that I can call subarray on both
  a.subarray = a.slice;

  Object.assign(a, COL_STR_PROTO);
};

const COL_NUM_PROTO = {

  /**
   * @param {DType} toDtype
   * @returns {ColNum}
   */
  cast(toDtype) {
    if (toDtype === this.dtype) {
      return this;
    }
    const newArr = empty(this.length, toDtype);
    newArr.set(this);
    return newArr;
  },

  /**
   * @returns {ColNum}
   */
  downcast() {
    const guess = guessNumDtype(this);
    if (guess === this.dtype) {
      return this;
    }
    const newArr = empty(this.length, guess);
    newArr.set(this);
    return newArr;
  },

  // manipulation, views and slices

  /**
   * @returns {number}
   */
  pop() {
    const fst = this[0];
    this.buffer = this.slice(1).buffer;
    return fst;
  },


  /**
   * @param {ColNum} other
   * @returns {ColNum}
   */
  concat(other) {
    let dtype = `f${opts.FLOAT_PREC}`;
    if (this.dtype[0] === other.dtype[0]) {
      dtype = this.BYTES_PER_ELEMENT >= other.BYTES_PER_ELEMENT ? this.dtype : other.dtype;
    } else if (other.dtype.startsWith('u') && this.dtype.startsWith('i')
      || this.dtype.startsWith('u') && other.dtype.startsWith('i')) {
      dtype = 'i32';
    } else if (other.dtype.startsWith('f')) {
      dtype = other.dtype;
    } else if (this.dtype.startsWith('f')) {
      dtype = this.dtype;
    }
    const newArr = empty(this.length + other.length, dtype);
    newArr.set(this);
    newArr.set(other, this.length);
    return newArr;
  },

  /**
   * @param {?number} [n]
   * @returns {ColNum}
   */
  nLargest(n = null) {
    if (n === null) {
      return this.nLargest(opts.HEAD_LEN);
    }
    return this.sort('des').subarray(0, n);
  },

  /**
   * @param {?number} [n]
   * @returns {ColNum}
   */
  nSmallest(n = null) {
    if (n === null) {
      return this.nSmallest(opts.HEAD_LEN);
    }
    return this.sort('asc').subarray(0, n);
  },

  // arithmetic

  /**
   * @param {?number|ColNum} [other]
   * @param {?DType} [dtype]
   * @returns {ColNum|number}
   */
  add(other = null, dtype = null) {
    if (other === null) {
      return this.reduce((x, y) => x + y, 0);
    }
    const myDtype = this.dtype;
    const amInt = myDtype[0] === 'i';
    const amUint = myDtype[0] === 'u';
    const amFloat = myDtype[0] === 'f';
    const myBits = this.BYTES_PER_ELEMENT * 8;

    if (isNumber(other)) {
      if (dtype !== null) {
        return empty(this.length, dtype).map((x) => x + other);
      }
      const isInt = Number.isInteger(other);
      const isNeg = other < 0;
      if (amFloat || isInt && (!isNeg || amInt)) {
        return this.map((x) => x + other);
      } else if (amUint && isInt && isNeg) {
        return empty(this.length, 'i32').map((_, idx) => this[idx] * other);
      } else {
        return empty(this.length, `f${opts.FLOAT_PREC}`).map((_, idx) => this[idx] * other);
      }
    }

    // else if other is enhanced array
    if (dtype !== null) {
      return empty(this.length, dtype).map((_, idx) => this[idx] * other[idx]);
    }

    // tried to call typedarray.add([1, 2, 3]) with regular arrary
    if (Array.isArray(other)) {
      return this.add(from(other));
    }

    const otherDtype = other.dtype;

    // if other is an EnhancedTypedArray
    const isFloat = otherDtype[0] === 'f';
    const isInt = otherDtype[0] === 'i';
    const isUint = otherDtype[0] === 'u';
    const otherBits = other.BYTES_PER_ELEMENT * 8;
    const len = Math.min(this.length, other.length);

    if (isFloat && amFloat || isUint && amUint || isInt && amInt) {
      if (other.BYTES_PER_ELEMENT >= this.BYTES_PER_ELEMENT) {
        return other.map((x, idx) => x + this[idx]);
      } else {
        return this.map((x, idx) => x + other[idx]);
      }
    } else if (amFloat) {
      return this.map((x, idx) => x + other[idx]);
    } else if (isFloat) {
      return other.map((x, idx) => x + this[idx]);
    } else if (amInt && isUint) {
      if (myBits >= otherBits * 2) {
        return this.map((x, idx) => x + other[idx]);
      } else {
        return empty(len, 'i32').map((_, idx) => this[idx] + other[idx]);
      }
    } else if (isInt && amUint) {
      if (otherBits >= myBits * 2) {
        return other.map((x, idx) => x + this[idx]);
      } else {
        return empty(len, `Int${Math.min(32, otherBits * 2)}`).map((_, idx) => this[idx] + other[idx]);
      }
    }
    return empty(len, `f${opts.FLOAT_PREC}`).map((_, idx) => this[idx] * other[idx]);
  },

  /**
   * @param {?number|ColNum} [other]
   * @param {?DType} [dtype]
   * @returns {ColNum|number}
   */
  sub(other = null, dtype = null) {
    if (other === null) {
      return this.reduce((x, y) => x - y);
    }

    // is array, elemnt-wise op
    if (!isNumber(other)) {
      // tODO fix inefficient a.sub
      return this.add(other.mul(-1, dtype), dtype);
    }

    // is number (so subtract other for all elements)

    if (this.dtype[0] === 'f') {
      return this.map((x) => x - other);
    }

    // am int and is int (but could be signed)
    if (Number.isInteger(other)) {
      const bits = this.BYTES_PER_ELEMENT * 8;
      const worstCase1 = 2 ** bits - other;
      const worstCase2 = 2 ** bits + other;
      const worstCase3 = -(2 ** bits) + other;
      const worstCase4 = -(2 ** bits) - other;
      const scenarios = [
        worstCase1, worstCase2, worstCase3, worstCase4,
      ];
      return empty(this.length, guessNumDtype(scenarios)).map((_, idx) => this[idx] - other);
    }

    return empty(this.length, `f${opts.FLOAT_PREC}`).map((_, idx) => this[idx] - other);
  },

  /**
   * @param {?number|ColNum} [other]
   * @param {?DType} [dtype]
   * @returns {ColNum|number}
   */
  mul(other = null, dtype = null) {
    if (other === null) {
      return this.reduce((x, y) => x * y, 1);
    }
    const myDtype = this.dtype;
    const amInt = myDtype.indexOf('i') >= 0;
    const amUint = myDtype.indexOf('u') >= 0;
    const amFloat = myDtype.indexOf('f') >= 0;
    const myBits = this.BYTES_PER_ELEMENT * 8;

    if (isNumber(other)) {
      if (dtype !== null) {
        return empty(this.length, dtype)
          .map((x) => x * other);
      }
      const isInt = Number.isInteger(other);
      const isNeg = other < 0;
      if (amFloat || isInt && (!isNeg || amInt)) {
        return this.map((x) => x * other);
      } else if (amUint && isInt && isNeg) {
        return empty(this.length, `i32`).map((_, idx) => this[idx] * other);
      } else {
        return empty(this.length, `f${opts.FLOAT_PREC}`).map((_, idx) => this[idx] * other);
      }
    }

    // else if other is enhanced array
    if (dtype !== null) {
      return empty(this.length, dtype)
        .map((_, idx) => this[idx] * other[idx]);
    }

    if (Array.isArray(other)) {
      return this.mul(from(other));
    }

    // if other is an EnhancedTypedArray
    const isFloat = other.dtype.indexOf('f') >= 0;
    const isInt = other.dtype.indexOf('i') >= 0;
    const isUint = other.dtype.indexOf('u') >= 0;
    const otherBits = other.BYTES_PER_ELEMENT * 8;
    const len = Math.min(this.length, other.length);

    if (isFloat && amFloat) {
      if (other.BYTES_PER_ELEMENT >= this.BYTES_PER_ELEMENT) {
        return other.map((x, idx) => x * this[idx]);
      } else {
        return this.map((x, idx) => x * other[idx]);
      }
    } else if (amFloat) {
      return this.map((x, idx) => x * other[idx]);
    } else if (isFloat) {
      return other.map((x, idx) => x * this[idx]);
    } else if (amUint && isUint) {
      if (other.BYTES_PER_ELEMENT >= this.BYTES_PER_ELEMENT) {
        return other.map((x, idx) => x * this[idx]);
      } else {
        return this.map((x, idx) => x * other[idx]);
      }
    } else if (amInt && isUint) {
      if (myBits >= otherBits * 2) {
        return this.map((x, idx) => x * other[idx]);
      } else {
        return empty(len, 'i32').map((_, idx) => this[idx] * other[idx]);
      }
    } else if (isInt && amUint) {
      if (otherBits >= myBits * 2) {
        return other.map((x, idx) => x * this[idx]);
      } else {
        return empty(len, `Int${Math.min(32, otherBits * 2)}`).map((_, idx) => this[idx] * other[idx]);
      }
    }
    return empty(len, `f${opts.FLOAT_PREC}`).map((_, idx) => this[idx] * other[idx]);
  },

  /**
   * @param {?number|ColNum} [other]
   * @param {?DType} [dtype]
   * @returns {ColNum|number}
   */
  div(other = null, dtype = null) {
    if (other === null) {
      return this.reduce((x, y) => x / y);
    }
    const myDtype = this.dtype;
    const amFloat = myDtype.indexOf('f') >= 0;

    if (isNumber(other)) {
      if (dtype !== null) {
        return empty(this.length, dtype).map((x) => x / other);
      }
      return empty(this.length, `f${opts.FLOAT_PREC}`).map((_, idx) => this[idx] / other);
    }

    // else if other is enhanced array
    if (dtype !== null) {
      return empty(this.length, dtype).map((_, idx) => this[idx] / other[idx]);
    }

    if (Array.isArray(other)) {
      return this.div(from(other));
    }

    // if other is an EnhancedTypedArray
    const isFloat = other.dtype.indexOf('f') >= 0;
    const len = Math.min(this.length, other.length);

    if (isFloat && amFloat) {
      if (other.BYTES_PER_ELEMENT > this.BYTES_PER_ELEMENT) {
        return other.map((x, idx) => x / this[idx]);
      } else {
        return this.map((x, idx) => x / other[idx]);
      }
    } else if (amFloat) {
      return this.map((x, idx) => x / other[idx]);
    } else if (isFloat) {
      return other.map((x, idx) => x / this[idx]);
    }
    return empty(len, `f${opts.FLOAT_PREC}`).map((_, idx) => this[idx] / other[idx]);
  },

  /**
   * @param {number} n
   * @param {?DType} [dtype]
   * @returns {ColNum}
   */
  root(n, dtype = null) {
    return this.pow(1 / n, dtype);
  },

  /**
   * @param {?DType} [dtype]
   * @returns {ColNum}
   */
  sqrt(dtype = null) {
    if (dtype === null || dtype === this.dtype) {
      return this.map((x) => Math.sqrt(x));
    } else {
      return empty(this.length, dtype).map((x) => Math.sqrt(x));
    }
  },

  /**
   * @param {?DType} [dtype]
   * @returns {ColNum}
   */
  cbrt(dtype = null) {
    if (dtype === null || dtype === this.dtype) {
      return this.map((x) => Math.cbrt(x));
    } else {
      return empty(this.length, dtype).map((x) => Math.cbrt(x));
    }
  },

  /**
   * @param {number} n
   * @param {?DType} [dtype]
   * @returns {ColNum}
   */
  pow(n, dtype = null) {
    if (n === 0) {
      return ones(this.length, dtype);
    } else if (n === 1) {
      return this.clone(dtype);
    } else if (dtype === null || this.dtype === dtype) {
      return this.map((x) => x ** n);
    } else {
      return empty(this.length, dtype).map((_, idx) => this[idx] ** n);
    }
  },

  /**
   * @param {?DType} [dtype]
   * @returns {ColNum}
   */
  cube(dtype = null) {
    return this.pow(3, dtype);
  },

  /**
   * @param {?DType} [dtype]
   * @returns {ColNum}
   */
  square(dtype = null) {
    return this.pow(2, dtype);
  },

  // basic math ops

  /**
   * @returns {ColNum}
   */
  abs() {
    const { dtype } = this;
    if (dtype.startsWith('i')) {
      return this.cast(`u${Math.min(32, this.BYTES_PER_ELEMENT * 8 * 2)}`);
    } else {
      return this.map((x) => Math.abs(x));
    }
  },

  /**
   * @returns {ColNum}
   */
  trunc() {
    log.info('you might want to downcast now to save memory');
    return this.map((x) => Math.trunc(x));
  },

  /**
   * @returns {ColNum}
   */
  ceil() {
    log.info('you might want to downcast now to save memory');
    return this.map((x) => Math.ceil(x));
  },

  /**
   * @returns {ColNum}
   */
  round() {
    log.info('you might want to downcast now to save memory');
    return this.map((x) => Math.round(x));
  },

  /**
   * @returns {ColNum}
   */
  floor() {
    log.info('you might want to downcast now to save memory');
    return this.map((x) => Math.floor(x));
  },

  // basic stats

  /**
   * @returns {number|undefined}
   */
  max() {
    return this.length === 1
      ? this[0]
      : this.reduce((v1, v2) => Math.max(v1, v2));
  },

  /**
   * @returns {number|undefined}
   */
  min() {
    return this.length === 1
      ? this[0]
      : this.reduce((v1, v2) => Math.min(v1, v2));
  },

  /**
   * @returns {number|undefined}
   */
  skewness() {
    const xs = this.cast(`f${opts.FLOAT_PREC}`);
    return xs.sub(this.mean())
      .cube()
      .mean() / xs.var() ** (3 / 2);
  },

  /**
   * @param {ColNum} other
   * @returns {number}
   */
  corr(other) {
    const muDiffX = this.cast(`f${opts.FLOAT_PREC}`).sub(this.mean());
    const muDiffY = other.cast(`f${opts.FLOAT_PREC}`).sub(other.mean());
    return muDiffX.mul(muDiffY).add() / (Math.sqrt(muDiffX.square().add()) * Math.sqrt(muDiffY.square().add()));
  },

  /**
   * @param {ColNum} other
   * @returns {number}
   */
  cov(other) {
    return other.sub(other.mean()).mul(this.sub(this.mean())).mean();
  },

  /**
   * @param {ColNum} other
   * @param {number} [p]
   * @returns {*}
   */
  distance(other, p = 2) {
    if (p === 1) {
      return this.sub(other).abs().add();
    } else if (p === 2) {
      return Math.sqrt(this.sub(other).square().add());
    } else {
      return this.sub(other).abs().pow(p).add() ** (1 / p);
    }
  },

  /**
   * @returns {number|undefined}
   */
  kurtosis() {
    const mu = this.mean();
    const xs = this.cast(`f${opts.FLOAT_PREC}`);
    const subMu = xs.sub(mu);
    const numerator = subMu.pow(4).add() / this.length;
    const denominator = (subMu.square().add() / this.length) ** 2;
    return numerator / denominator - 3;
  },

  /**
   * @param {number} n
   * @param {boolean} [wr]
   * @returns {ColNum}
   */
  sample(n, wr = true) {
    if (n === null) {
      return this.sample(this.length, wr);
    }
    if (n < 1) {
      return this.sample(Math.floor(this.length * n), wr);
    }
    if (wr) {
      return this.subarray(0, n).map(() => this[randInt(0, this.length)]);
    }
    const sample = empty(n, `f${opts.FLOAT_PREC}`);
    const used = new Set();
    for (let ptr = 0; ptr < n; ptr++) {
      let idx;
      do {
        idx = Math.floor(Math.random() * this.length);
      } while (used.has(idx));
      sample[ptr] = this[idx];
      used.add(idx);
    }
    return sample;
  },

  // central tendency

  /**
   * @returns {number|undefined}
   */
  mean() { return this.add() / this.length; },

  /**
   * @param {number} [n]
   * @param {number} [m]
   * @returns {number}
   */
  nQuart(n = 2, m = 4) {
    const ys = this.sort();
    if ((ys.length * n / m) % 1 !== 0) {
      return ys[Math.floor(ys.length * n / m)];
    }
    const middle = ys.length * n / m;
    return (ys[middle] + ys[middle - 1]) / 2;
  },

  /**
   * @returns {number|undefined}
   */
  Q1() { return this.nQuart(1, 4); },

  /**
   * @returns {number|undefined}
   */
  median() { return this.nQuart(2, 4); },

  /**
   * @returns {number|undefined}
   */
  Q3() { return this.nQuart(3, 4); },

  // spread

  /**
   * @param {?DType} [dtype]
   * @returns {number|undefined}
   */
  var(dtype = null) { return this.sub(this.mean(), dtype).square(dtype).mean(); },

  /**
   * @param {?DType} [dtype]
   * @returns {number|undefined}
   */
  mad(dtype = null) { return this.sub(this.mean(), dtype).abs().mean(); },

  /**
   * @param {?DType} [dtype]
   * @returns {number|undefined}
   */
  stdev(dtype = null) { return Math.sqrt(this.var(dtype)); },

  /**
   * @returns {number|undefined}
   */
  range() { return this.max() - this.min(); },

  /**
   * @returns {number}
   */
  IQR() { return this.Q3() - this.Q1(); },

  // linear algebra

  /**
   * @param {ColNum} other
   * @returns {number}
   */
  dot(other) { return this.mul(other).add(); },

  // pre-processing

  /**
   * INPUT:
   * a = [2, 3, 1, 4, 5, 6]
   * k = 2
   *
   * 1. Sort:
   *
   *  [1, 2, 3, 4, 5, 6]
   *
   * 2. Determine bin size:
   *
   *  binSize = a.length / k = 6 / 2 = 3
   *
   * 3. Determine boundaries:
   *
   *  bounds = [_, Infinity]
   *
   * 4. Bound 1 is in place binSize i.e. sortedA[3] = 4
   *    meaning all less than 4 are in bin #0
   *
   *  bounds = [4, Infinity]
   *
   * 5. Try to advance to next bin: 3 + binSize = 6. Out of bounds!
   *
   * @param {number} [k]
   * @returns {ColNum}
   */
  kBins(k = 5) {
    const sorted = this.sort();
    const bounds = Array(k).fill(0);
    bounds[bounds.length - 1] = Infinity;
    const binSize = Math.floor(this.length / k);

    let boundIdx = 0;

    for (let i = binSize; i < this.length; i += binSize) {
      bounds[boundIdx] = sorted[i];
      boundIdx++;
    }

    const dtype = guessNumDtype([k - 1]);
    const s = empty(this.length, dtype);

    for (let i = 0; i < this.length; i++) {
      const val = this[i];
      for (let boundIndex = 0; boundIndex < k; boundIndex++) {
        const boundVal = bounds[boundIndex];
        if (val < boundVal) {
          s[i] = boundIndex;
          break;
        }
      }
    }

    s.kBinsBounds = bounds;

    return s;
  },

  /**
   * @param {number} [ord]
   * @returns {ColNum}
   */
  disDiff(ord = 1) {
    if (ord === 0) {
      return this;
    }
    const newArr = empty(this.length - 1, `f${opts.FLOAT_PREC}`);
    for (let i = 0; i < newArr.length; i++) {
      newArr[i] = this[i + 1] - this[i];
    }
    return newArr.disDiff(ord - 1);
  },

  /**
   * @param {number} [n]
   * @param {boolean} [doClone]
   * @returns {ColNum|ColStr}
   */
  smooth(n = 2, doClone = false) {
    if (n === 0) {
      throw new Error(`smoothing n must be >= 2`);
    }
    if (n === 1) {
      return doClone ? this.clone() : this;
    }
    const newArr = this.convert(`f${opts.FLOAT_PREC}`, true);
    for (let i = 0; i < n; i++) {
      let total = 0;
      for (let j = 0; j < n; j++) {
        const val = this[i + n - j - 1];
        total += val;
      }
      newArr[i] = total / n;
    }
    for (let i = n; i < this.length; i++) {
      let total = 0;
      for (let j = 0; j < n; j++) {
        const val = this[i - n + j];
        total += val;
      }
      newArr[i] = total / n;
    }
    return newArr;
  },

  /**
   * @returns {ColNum}
   */
  normalize() {
    const smallest = this.min();
    const denominator = this.max() - smallest;
    return this.map((x) => (x - smallest) / denominator);
  },

  /**
   * @returns {ColNum}
   */
  removeOutliers() {
    const Q1 = this.Q1();
    const Q3 = this.Q3();
    return this.filter((x) => x >= Q1 && x <= Q3);
  },

  /**
   * @param {?number} [lBound]
   * @param {?number} [uBound]
   * @returns {ColNum}
   */
  clip(lBound = null, uBound = null) {
    if (lBound !== null && uBound !== null) {
      return this.map((v) => v < lBound ? lBound : v > uBound ? uBound : v);
    } else if (lBound !== null) {
      return this.map((v) => v < lBound ? lBound : v);
    } else {
      return this.map((v) => v > uBound ? uBound : v);
    }
  },

  /**
   * @returns {ColNum}
   */
  clipOutliers() { return this.clip(this.Q1(), this.Q3()); },

  /**
   * @param {number} v
   * @param {number} y
   * @param {number} [delta]
   * @returns {ColNum}
   */
  replace(v, y, delta = 1E-4) {
    return this.map((x) => Math.abs(x - v) <= delta ? y : x);
  },

  // hacks

  /**
   * @param {number} a
   * @param {number} b
   * @returns {ColNum}
   */
  slice(a, b) {
    const xs = this._slice(a, b);
    enh(xs);
    enhTypedArr(xs);
    return xs;
  },

  /**
   * @param {number} a
   * @param {number} b
   * @returns {ColNum}
   */
  subarray(a, b) {
    const xs = this._subarray(a, b);
    enh(xs);
    enhTypedArr(xs);
    return xs;
  },


  /**
   * @param {function(*, number, ColNum): boolean} f
   * @returns {ColNum}
   */
  filter(f) {
    const xs = this._filter(f);
    enh(xs);
    enhTypedArr(xs);
    return xs;
  },
};

/**
 * @param {TypedArray|ColNum} a
 * @private
 */
const enhTypedArr = (a) => {
  // already enhanced
  if (a.dtype !== undefined && a.dtype !== 's') {
    return;
  }

  // hacks necessary to ensure immutability
  a._subarray = a.subarray;

  const match = dtypeRegex.exec(a.constructor.name);
  a.dtype = match[1][0].toLocaleLowerCase() + match[2];

  Object.assign(a, COL_NUM_PROTO);
};

/**
 * @param {Array<number>|TypedArray} xs
 * @param {?number} [floatSize]
 * @returns {'i8'|'i16'|'i32'|'u8'|'u16'|'u32'|'f32'|'f64'} dtype
 * @private
 */
const guessNumDtype = (xs, floatSize = null) => {
  if (floatSize === null) {
    return guessNumDtype(xs, opts.FLOAT_PREC);
  }

  const notNaN = xs.filter((x) => !Object.is(NaN, x));
  const largest = notNaN.reduce((a, b) => Math.max(a, b));
  const smallest = notNaN.reduce((a, b) => Math.min(a, b));
  const isFloat = notNaN.some((x) => !Number.isInteger(x));
  log.debug(`max num is ${largest}, and min num is ${smallest}`);

  // reals
  if (isFloat) {
    if (smallest < 1.23e-38 || largest > 3.4e38) {
      log.debug('opted for f64');
      return 'f64';
    }
    log.debug('opted for f32');
    return 'f32';
  }

  const isNeg = smallest < 0;
  let bitsNeeded = Math.ceil(Math.log2(Math.max(largest + 1, Math.abs(smallest - 1))));

  if (isNeg) {
    bitsNeeded++; // sign bit
  }

  // integers
  if (isNeg) {
    if (bitsNeeded <= 8) {
      log.debug('opted for i8');
      return 'i8';
    } else if (bitsNeeded <= 16) {
      log.debug('opted for i16');
      return 'i16';
    } else if (bitsNeeded <= 32) {
      log.debug('opted for i32');
      return 'i32';
    }
  }

  log.debug(`guessed un-signed integer`);

  // natural numbers
  if (bitsNeeded <= 8) {
    log.debug('opted for u8');
    return 'u8';
  } else if (bitsNeeded <= 16) {
    log.debug('opted for u16');
    return 'u16';
  } else if (bitsNeeded <= 32) {
    log.debug('opted for u32');
    return 'u32';
  }

  log.debug(`huge number ${largest}, defaulting to f64`);
  return 'f64'; // huge number
};

/**
 * @param {DType} dtype
 * @returns {Uint8ArrayConstructor|Uint16ArrayConstructor|Uint32ArrayConstructor|Int8ArrayConstructor|Int16ArrayConstructor|Int32ArrayConstructor|Float32ArrayConstructor|Float64ArrayConstructor} constructor
 * @private
 */
const constFromDtype = (dtype) => {
  const match = dtypeRegex.exec(dtype);
  const nBits = match[2];
  const prefix = match[1];
  let type;
  if (prefix === 'f') {
    type = 'Float';
  } else if (prefix === 'u') {
    type = 'Uint';
  } else if (prefix === 'i') {
    type = 'Int';
  }
  return eval(`${type}${nBits}Array`);
};

/**
 *
 * @param {number} [a]
 * @param {?number} [b]
 * @param {number} [step]
 * @private
 */
const rangeIter = function* (a = 0, b = null, step = 1) {
  if (b === null) {
    yield *rangeIter(0, a, step);
  } else {
    for (let i = a; i < b; i += step) {
      yield i;
    }
  }
};

/**
 *
 * @param {number} [a]
 * @param {?number} [b]
 * @param {number} [step]
 * @returns {ColNum} range
 */
const range = (a = 0, b = null, step = 1) => {
  if (b === null) {
    return range(0, a);
  }
  const newArr = empty(Math.floor(Math.ceil(b - a) / step), guessNumDtype([b - step, a + step]));
  let i = 0;
  for (const n of rangeIter(a, b, step)) {
    newArr[i] = n;
    i++;
  }
  return newArr;
};

/**
 * @param {Array<number>|Array<string>|TypedArray|ColNum|ColStr} xs
 * @param {?DType} [toDtype]
 * @param {boolean} [doClone]
 * @returns {ColNum|ColStr} column
 */
const from = (xs, toDtype = null, doClone = true) => {
  if (toDtype === xs.dtype) {
    log.debug(`dtype matches hint, cloning ${xs.toString()}`);
    // preserve semantics of Array.from, which clones
    if (doClone) {
      log.debug(`cloning ${xs.toString()}`);
      return xs.clone();
    } else {
      log.debug('returning as is');
      return xs;
    }
  }

  if (toDtype === null && xs.dtype !== undefined && xs.dtype !== 's') {
    log.debug('no dtype hint');
    log.debug(`dtype is numeric ${xs.dtype}`);
    // preserve semantics of Array.from, which clones
    return doClone ? xs.clone() : xs;
  }

  // use toDtype hint
  if (toDtype !== null && toDtype !== 's') {
    log.debug(`using dtype hint to make ${toDtype} Column`);
    const view = empty(xs.length, toDtype);
    view.set(xs);
    return view;
  }

  // return empty arrays
  if (xs.length === 0) {
    log.debug(`empty input, returning empty col ${xs.toString()}`);
    const ys = xs.constructor();
    enh(ys);
    enhStrArr(ys);
    return ys;
  }

  if (!xs.some((x) => !isNumber(x) && !Object.is(NaN, x))) {
    log.debug(`got array of numbers, creating ColNum`);
    const ys = empty(xs.length, toDtype);
    ys.set(xs);
    return ys;
  }

  if (toDtype === 's') {
    log.debug('using s dtype hint to not try to parse values (saving time)');
    if (!xs.some(s => s.constructor.name[0] === 'S')) {
      log.debug('converting nums in column to string');
      xs = xs.map(x => x.toString());
    }
    enh(xs);
    enhStrArr(xs);
    return xs;
  }

  /*
   * save some computation time by checking
   * if there is at least one num-like string
   */
  if (xs.some((x) => x && x.constructor.name[0] === 'S' && x.search(isNumRegex) >= 0)) {
    /*
     * THEN try parsing all
     * const tryParse = empty(xs.length, toDtype);
     */
    let okCount = 0;
    for (let idx = 0; idx < xs.length; idx++) {
      if (xs[idx].search !== undefined && xs[idx].search(isNumRegex) >= 0) {
        okCount++;
      }
    }

    const okRatio = okCount / xs.length;

    // make sure most is OK
    if (okRatio >= opts.PARSE_NUM_RATIO) {
      log.debug(`OK ${okRatio.toFixed(2)} of strings in the array are num-like ${okRatio < 0.95 ? `(loss of ${(1 - okRatio).toFixed(2)} data)` : ''}`);
      const tryParse = empty(xs.length, toDtype);
      for (let idx = 0; idx < xs.length; idx++) {
        tryParse[idx] = parseFloat(xs[idx]);
      }
      log.debug(`OK parsed string array to ${tryParse.dtype} Column`);
      return tryParse;
    } else {
      log.debug(`FAILED to convert to ColNum, num-like rows = ${okRatio.toFixed(2)}`);
    }
  }

  log.debug('failed to parse string array, creating s Col');
  if (!xs.some((s) => s.constructor.name[0] === 'S')) {
    log.debug('converting nums in column to string');
    xs = xs.map((x) => x.toString());
  }
  enh(xs);
  enhStrArr(xs);
  return xs;
};

/**
 * @param {number} [len]
 * @param {?DType|'s'} dtype
 * @returns {ColNum|ColStr} empty column
 */
const empty = (len = 0, dtype = null) => {
  if (dtype === 's') {
    const xs = Array(len).fill(null);
    enh(xs);
    enhStrArr(xs);
    return xs;
  } else if (dtype === null) {
    return empty(len, `f${opts.FLOAT_PREC}`);
  }
  switch (dtype.toLowerCase()) {
  case 'f32': return ColF32(len);
  case 'f64': return ColF32(len);
  case 'u32': return ColU32(len);
  case 'u16': return ColU16(len);
  case 'u8': return ColU8(len);
  case 'i32': return ColI32(len);
  case 'i16': return ColI16(len);
  case 'i8': return ColI8(len);
  default: throw new Error(`unrecognised dtype "${dtype}"`);
  }
};

/**
 * @param {number} len
 * @param {?number} [lBound]
 * @param {?number} [uBound]
 * @param {?DType|'s'} [dtype]
 * @returns {ColNum|ColStr} rand array
 */
const rand = (len, lBound = null, uBound = null, dtype = null) => {
  if (dtype === 's') {
    // eslint-disable-next-line no-shadow
    const range = uBound - lBound;
    const LOWER_RANGE = 122 - 97;
    const UPPER_RANGE = 90 - 65;
    const makeChar = () => {
      const r = Math.random();
      if (r < 0.5) {
        return 97 + Math.floor(Math.random() * LOWER_RANGE);
      } else if (r < 0.1) {
        return 32;
      } else {
        return 65 + Math.floor(Math.random() * UPPER_RANGE);
      }
    };
    return empty(len, dtype).map(() => String.fromCharCode(...Array(lBound + Math.floor(Math.random() * range)).fill(0).map(makeChar)));
  } else {
    if (lBound === null) {
      return rand(len, 0, uBound, dtype);
    } else if (uBound === null) {
      return rand(len, lBound, lBound + 1, dtype);
    }
    // else
    return empty(len, dtype).map(() => randInRange(lBound, uBound));
  }
};

/**
 * @param {number} len
 * @param {number} val
 * @param {?DType} [dtype]
 * @returns {ColNum|ColStr} array filled with value
 */
const repeat = (len, val, dtype = null) => empty(len, dtype === null ? isString(val) ? 's' : guessNumDtype([val]) : dtype).fill(val);

/**
 * @param {number} len
 * @param {?DType} [dtype]
 * @returns {ColNum} array of zeros
 */
const ones = (len, dtype = null) => repeat(len, 1, dtype);

/**
 * By default typed arrays are filled with 0 so no need to .repeat()
 *
 * @param {number} len
 * @param {?DType} [dtype]
 * @returns {ColNum} array of zeros
 */
const zeros = (len, dtype = null) => empty(len, dtype === null ? 'u8' : dtype);

/**
 * @param {...*}  xs
 * @returns {ColStr|ColNum} array
 */
const of = (...xs) => from(xs, null, false);

/**
 * @param {*} xs
 * @returns {boolean}
 */
const isColNum = (xs) => xs.dtype !== undefined && !!xs.dtype.match(dtypeRegex);

/**
 * @param {*} xs
 * @returns {boolean}
 */
const isColStr = (xs) => xs.dtype === 's';

/**
 * @param {*} xs
 * @returns {boolean}
 */
const isCol = (xs) => isColNum(xs) || isColStr(xs);

/**
 * @param {function(number, number, (ColStr|ColNum)): *} f
 * @param {number} n
 * @param {?DType|'s'} [dtype]
 * @returns {ColNum|ColStr}
 */
const fromFunct = (f = (x) => x, n = 0, dtype = null) => {
  const xs = Array(n).fill(0);
  for (let i = 0; i < xs.length; i++) {
    xs[i] = f(xs[i], i, xs);
  }
  return from(xs, dtype, false);
};

const PRODUCERS = {};
for (const p of [
  'Uint8', 'Uint16', 'Uint32', 'Int8', 'Int16', 'Int32', 'Float32', 'Float64'
]) {
  const dtype = p.toLowerCase()
    .replace('uint', 'U')
    .replace('float', 'F')
    .replace('int', 'I');

  /**
   * @param {number} [len]
   * @returns {ColNum}
   */
  PRODUCERS[`Col${dtype}`] = (len = 0) => {
    const match = dtypeRegex.exec(dtype);
    const bytesNeeded = parseInt(match[2]) / 8;
    const constructor = constFromDtype(dtype.toLowerCase());
    const arr = new constructor(new ArrayBuffer(bytesNeeded * len));
    enh(arr);
    enhTypedArr(arr);
    return arr;
  };
}

// eslint-disable-next-line no-unused-vars
const { ColF32, ColF64, ColU8, ColU16, ColU32, ColI8, ColI16, ColI32 } = PRODUCERS;

Object.setPrototypeOf(COL_STR_PROTO, COL_PROTO);
Object.setPrototypeOf(COL_NUM_PROTO, COL_PROTO);

module.exports = Object.freeze(
  { ...({
    empty,
    repeat,
    from,
    fromFunct,
    isCol,
    isColNum,
    isColStr,
    of,
    ones,
    opts,
    rand,
    range,
    zeros,
  }),
  ...PRODUCERS,
  ...({
    constFromDtype,
    guessNumDtype,
    rangeIter,
  })
  },
);
