// node_modules/pdfjs-dist/legacy/build/pdf.mjs
var __webpack_modules__ = {
  /***/
  9306: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isCallable = __webpack_require__2(4901);
      var tryToString = __webpack_require__2(6823);
      var $TypeError = TypeError;
      module.exports = function(argument) {
        if (isCallable(argument)) return argument;
        throw new $TypeError(tryToString(argument) + " is not a function");
      };
    })
  ),
  /***/
  3506: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isPossiblePrototype = __webpack_require__2(3925);
      var $String = String;
      var $TypeError = TypeError;
      module.exports = function(argument) {
        if (isPossiblePrototype(argument)) return argument;
        throw new $TypeError("Can't set " + $String(argument) + " as a prototype");
      };
    })
  ),
  /***/
  7080: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var has = __webpack_require__2(4402).has;
      module.exports = function(it) {
        has(it);
        return it;
      };
    })
  ),
  /***/
  679: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isPrototypeOf = __webpack_require__2(1625);
      var $TypeError = TypeError;
      module.exports = function(it, Prototype) {
        if (isPrototypeOf(Prototype, it)) return it;
        throw new $TypeError("Incorrect invocation");
      };
    })
  ),
  /***/
  8551: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isObject = __webpack_require__2(34);
      var $String = String;
      var $TypeError = TypeError;
      module.exports = function(argument) {
        if (isObject(argument)) return argument;
        throw new $TypeError($String(argument) + " is not an object");
      };
    })
  ),
  /***/
  7811: (
    /***/
    ((module) => {
      module.exports = typeof ArrayBuffer != "undefined" && typeof DataView != "undefined";
    })
  ),
  /***/
  7394: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var uncurryThisAccessor = __webpack_require__2(6706);
      var classof = __webpack_require__2(2195);
      var ArrayBuffer2 = globalThis2.ArrayBuffer;
      var TypeError2 = globalThis2.TypeError;
      module.exports = ArrayBuffer2 && uncurryThisAccessor(ArrayBuffer2.prototype, "byteLength", "get") || function(O) {
        if (classof(O) !== "ArrayBuffer") throw new TypeError2("ArrayBuffer expected");
        return O.byteLength;
      };
    })
  ),
  /***/
  3238: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var uncurryThis = __webpack_require__2(7476);
      var arrayBufferByteLength = __webpack_require__2(7394);
      var ArrayBuffer2 = globalThis2.ArrayBuffer;
      var ArrayBufferPrototype = ArrayBuffer2 && ArrayBuffer2.prototype;
      var slice = ArrayBufferPrototype && uncurryThis(ArrayBufferPrototype.slice);
      module.exports = function(O) {
        if (arrayBufferByteLength(O) !== 0) return false;
        if (!slice) return false;
        try {
          slice(O, 0, 0);
          return false;
        } catch (error) {
          return true;
        }
      };
    })
  ),
  /***/
  5169: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isDetached = __webpack_require__2(3238);
      var $TypeError = TypeError;
      module.exports = function(it) {
        if (isDetached(it)) throw new $TypeError("ArrayBuffer is detached");
        return it;
      };
    })
  ),
  /***/
  5636: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var uncurryThis = __webpack_require__2(9504);
      var uncurryThisAccessor = __webpack_require__2(6706);
      var toIndex = __webpack_require__2(7696);
      var notDetached = __webpack_require__2(5169);
      var arrayBufferByteLength = __webpack_require__2(7394);
      var detachTransferable = __webpack_require__2(4483);
      var PROPER_STRUCTURED_CLONE_TRANSFER = __webpack_require__2(1548);
      var structuredClone2 = globalThis2.structuredClone;
      var ArrayBuffer2 = globalThis2.ArrayBuffer;
      var DataView2 = globalThis2.DataView;
      var min = Math.min;
      var ArrayBufferPrototype = ArrayBuffer2.prototype;
      var DataViewPrototype = DataView2.prototype;
      var slice = uncurryThis(ArrayBufferPrototype.slice);
      var isResizable = uncurryThisAccessor(ArrayBufferPrototype, "resizable", "get");
      var maxByteLength = uncurryThisAccessor(ArrayBufferPrototype, "maxByteLength", "get");
      var getInt8 = uncurryThis(DataViewPrototype.getInt8);
      var setInt8 = uncurryThis(DataViewPrototype.setInt8);
      module.exports = (PROPER_STRUCTURED_CLONE_TRANSFER || detachTransferable) && function(arrayBuffer, newLength, preserveResizability) {
        var byteLength = arrayBufferByteLength(arrayBuffer);
        var newByteLength = newLength === void 0 ? byteLength : toIndex(newLength);
        var fixedLength = !isResizable || !isResizable(arrayBuffer);
        var newBuffer;
        notDetached(arrayBuffer);
        if (PROPER_STRUCTURED_CLONE_TRANSFER) {
          arrayBuffer = structuredClone2(arrayBuffer, { transfer: [arrayBuffer] });
          if (byteLength === newByteLength && (preserveResizability || fixedLength)) return arrayBuffer;
        }
        if (byteLength >= newByteLength && (!preserveResizability || fixedLength)) {
          newBuffer = slice(arrayBuffer, 0, newByteLength);
        } else {
          var options = preserveResizability && !fixedLength && maxByteLength ? { maxByteLength: maxByteLength(arrayBuffer) } : void 0;
          newBuffer = new ArrayBuffer2(newByteLength, options);
          var a = new DataView2(arrayBuffer);
          var b = new DataView2(newBuffer);
          var copyLength = min(newByteLength, byteLength);
          for (var i = 0; i < copyLength; i++) setInt8(b, i, getInt8(a, i));
        }
        if (!PROPER_STRUCTURED_CLONE_TRANSFER) detachTransferable(arrayBuffer);
        return newBuffer;
      };
    })
  ),
  /***/
  4644: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var NATIVE_ARRAY_BUFFER = __webpack_require__2(7811);
      var DESCRIPTORS = __webpack_require__2(3724);
      var globalThis2 = __webpack_require__2(4576);
      var isCallable = __webpack_require__2(4901);
      var isObject = __webpack_require__2(34);
      var hasOwn = __webpack_require__2(9297);
      var classof = __webpack_require__2(6955);
      var tryToString = __webpack_require__2(6823);
      var createNonEnumerableProperty = __webpack_require__2(6699);
      var defineBuiltIn = __webpack_require__2(6840);
      var defineBuiltInAccessor = __webpack_require__2(2106);
      var isPrototypeOf = __webpack_require__2(1625);
      var getPrototypeOf = __webpack_require__2(2787);
      var setPrototypeOf = __webpack_require__2(2967);
      var wellKnownSymbol = __webpack_require__2(8227);
      var uid = __webpack_require__2(3392);
      var InternalStateModule = __webpack_require__2(1181);
      var enforceInternalState = InternalStateModule.enforce;
      var getInternalState = InternalStateModule.get;
      var Int8Array2 = globalThis2.Int8Array;
      var Int8ArrayPrototype = Int8Array2 && Int8Array2.prototype;
      var Uint8ClampedArray = globalThis2.Uint8ClampedArray;
      var Uint8ClampedArrayPrototype = Uint8ClampedArray && Uint8ClampedArray.prototype;
      var TypedArray = Int8Array2 && getPrototypeOf(Int8Array2);
      var TypedArrayPrototype = Int8ArrayPrototype && getPrototypeOf(Int8ArrayPrototype);
      var ObjectPrototype = Object.prototype;
      var TypeError2 = globalThis2.TypeError;
      var TO_STRING_TAG = wellKnownSymbol("toStringTag");
      var TYPED_ARRAY_TAG = uid("TYPED_ARRAY_TAG");
      var TYPED_ARRAY_CONSTRUCTOR = "TypedArrayConstructor";
      var NATIVE_ARRAY_BUFFER_VIEWS = NATIVE_ARRAY_BUFFER && !!setPrototypeOf && classof(globalThis2.opera) !== "Opera";
      var TYPED_ARRAY_TAG_REQUIRED = false;
      var NAME, Constructor, Prototype;
      var TypedArrayConstructorsList = {
        Int8Array: 1,
        Uint8Array: 1,
        Uint8ClampedArray: 1,
        Int16Array: 2,
        Uint16Array: 2,
        Int32Array: 4,
        Uint32Array: 4,
        Float32Array: 4,
        Float64Array: 8
      };
      var BigIntArrayConstructorsList = {
        BigInt64Array: 8,
        BigUint64Array: 8
      };
      var isView = function isView2(it) {
        if (!isObject(it)) return false;
        var klass = classof(it);
        return klass === "DataView" || hasOwn(TypedArrayConstructorsList, klass) || hasOwn(BigIntArrayConstructorsList, klass);
      };
      var getTypedArrayConstructor = function(it) {
        var proto = getPrototypeOf(it);
        if (!isObject(proto)) return;
        var state = getInternalState(proto);
        return state && hasOwn(state, TYPED_ARRAY_CONSTRUCTOR) ? state[TYPED_ARRAY_CONSTRUCTOR] : getTypedArrayConstructor(proto);
      };
      var isTypedArray = function(it) {
        if (!isObject(it)) return false;
        var klass = classof(it);
        return hasOwn(TypedArrayConstructorsList, klass) || hasOwn(BigIntArrayConstructorsList, klass);
      };
      var aTypedArray = function(it) {
        if (isTypedArray(it)) return it;
        throw new TypeError2("Target is not a typed array");
      };
      var aTypedArrayConstructor = function(C) {
        if (isCallable(C) && (!setPrototypeOf || isPrototypeOf(TypedArray, C))) return C;
        throw new TypeError2(tryToString(C) + " is not a typed array constructor");
      };
      var exportTypedArrayMethod = function(KEY, property, forced, options) {
        if (!DESCRIPTORS) return;
        if (forced) for (var ARRAY in TypedArrayConstructorsList) {
          var TypedArrayConstructor = globalThis2[ARRAY];
          if (TypedArrayConstructor && hasOwn(TypedArrayConstructor.prototype, KEY)) try {
            delete TypedArrayConstructor.prototype[KEY];
          } catch (error) {
            try {
              TypedArrayConstructor.prototype[KEY] = property;
            } catch (error2) {
            }
          }
        }
        if (!TypedArrayPrototype[KEY] || forced) {
          defineBuiltIn(TypedArrayPrototype, KEY, forced ? property : NATIVE_ARRAY_BUFFER_VIEWS && Int8ArrayPrototype[KEY] || property, options);
        }
      };
      var exportTypedArrayStaticMethod = function(KEY, property, forced) {
        var ARRAY, TypedArrayConstructor;
        if (!DESCRIPTORS) return;
        if (setPrototypeOf) {
          if (forced) for (ARRAY in TypedArrayConstructorsList) {
            TypedArrayConstructor = globalThis2[ARRAY];
            if (TypedArrayConstructor && hasOwn(TypedArrayConstructor, KEY)) try {
              delete TypedArrayConstructor[KEY];
            } catch (error) {
            }
          }
          if (!TypedArray[KEY] || forced) {
            try {
              return defineBuiltIn(TypedArray, KEY, forced ? property : NATIVE_ARRAY_BUFFER_VIEWS && TypedArray[KEY] || property);
            } catch (error) {
            }
          } else return;
        }
        for (ARRAY in TypedArrayConstructorsList) {
          TypedArrayConstructor = globalThis2[ARRAY];
          if (TypedArrayConstructor && (!TypedArrayConstructor[KEY] || forced)) {
            defineBuiltIn(TypedArrayConstructor, KEY, property);
          }
        }
      };
      for (NAME in TypedArrayConstructorsList) {
        Constructor = globalThis2[NAME];
        Prototype = Constructor && Constructor.prototype;
        if (Prototype) enforceInternalState(Prototype)[TYPED_ARRAY_CONSTRUCTOR] = Constructor;
        else NATIVE_ARRAY_BUFFER_VIEWS = false;
      }
      for (NAME in BigIntArrayConstructorsList) {
        Constructor = globalThis2[NAME];
        Prototype = Constructor && Constructor.prototype;
        if (Prototype) enforceInternalState(Prototype)[TYPED_ARRAY_CONSTRUCTOR] = Constructor;
      }
      if (!NATIVE_ARRAY_BUFFER_VIEWS || !isCallable(TypedArray) || TypedArray === Function.prototype) {
        TypedArray = function TypedArray2() {
          throw new TypeError2("Incorrect invocation");
        };
        if (NATIVE_ARRAY_BUFFER_VIEWS) for (NAME in TypedArrayConstructorsList) {
          if (globalThis2[NAME]) setPrototypeOf(globalThis2[NAME], TypedArray);
        }
      }
      if (!NATIVE_ARRAY_BUFFER_VIEWS || !TypedArrayPrototype || TypedArrayPrototype === ObjectPrototype) {
        TypedArrayPrototype = TypedArray.prototype;
        if (NATIVE_ARRAY_BUFFER_VIEWS) for (NAME in TypedArrayConstructorsList) {
          if (globalThis2[NAME]) setPrototypeOf(globalThis2[NAME].prototype, TypedArrayPrototype);
        }
      }
      if (NATIVE_ARRAY_BUFFER_VIEWS && getPrototypeOf(Uint8ClampedArrayPrototype) !== TypedArrayPrototype) {
        setPrototypeOf(Uint8ClampedArrayPrototype, TypedArrayPrototype);
      }
      if (DESCRIPTORS && !hasOwn(TypedArrayPrototype, TO_STRING_TAG)) {
        TYPED_ARRAY_TAG_REQUIRED = true;
        defineBuiltInAccessor(TypedArrayPrototype, TO_STRING_TAG, {
          configurable: true,
          get: function() {
            return isObject(this) ? this[TYPED_ARRAY_TAG] : void 0;
          }
        });
        for (NAME in TypedArrayConstructorsList) if (globalThis2[NAME]) {
          createNonEnumerableProperty(globalThis2[NAME], TYPED_ARRAY_TAG, NAME);
        }
      }
      module.exports = {
        NATIVE_ARRAY_BUFFER_VIEWS,
        TYPED_ARRAY_TAG: TYPED_ARRAY_TAG_REQUIRED && TYPED_ARRAY_TAG,
        aTypedArray,
        aTypedArrayConstructor,
        exportTypedArrayMethod,
        exportTypedArrayStaticMethod,
        getTypedArrayConstructor,
        isView,
        isTypedArray,
        TypedArray,
        TypedArrayPrototype
      };
    })
  ),
  /***/
  5370: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var lengthOfArrayLike = __webpack_require__2(6198);
      module.exports = function(Constructor, list, $length) {
        var index = 0;
        var length = arguments.length > 2 ? $length : lengthOfArrayLike(list);
        var result = new Constructor(length);
        while (length > index) result[index] = list[index++];
        return result;
      };
    })
  ),
  /***/
  9617: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var toIndexedObject = __webpack_require__2(5397);
      var toAbsoluteIndex = __webpack_require__2(5610);
      var lengthOfArrayLike = __webpack_require__2(6198);
      var createMethod = function(IS_INCLUDES) {
        return function($this, el, fromIndex) {
          var O = toIndexedObject($this);
          var length = lengthOfArrayLike(O);
          if (length === 0) return !IS_INCLUDES && -1;
          var index = toAbsoluteIndex(fromIndex, length);
          var value;
          if (IS_INCLUDES && el !== el) while (length > index) {
            value = O[index++];
            if (value !== value) return true;
          }
          else for (; length > index; index++) {
            if ((IS_INCLUDES || index in O) && O[index] === el) return IS_INCLUDES || index || 0;
          }
          return !IS_INCLUDES && -1;
        };
      };
      module.exports = {
        // `Array.prototype.includes` method
        // https://tc39.es/ecma262/#sec-array.prototype.includes
        includes: createMethod(true),
        // `Array.prototype.indexOf` method
        // https://tc39.es/ecma262/#sec-array.prototype.indexof
        indexOf: createMethod(false)
      };
    })
  ),
  /***/
  4527: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var isArray = __webpack_require__2(4376);
      var $TypeError = TypeError;
      var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      var SILENT_ON_NON_WRITABLE_LENGTH_SET = DESCRIPTORS && !(function() {
        if (this !== void 0) return true;
        try {
          Object.defineProperty([], "length", { writable: false }).length = 1;
        } catch (error) {
          return error instanceof TypeError;
        }
      })();
      module.exports = SILENT_ON_NON_WRITABLE_LENGTH_SET ? function(O, length) {
        if (isArray(O) && !getOwnPropertyDescriptor(O, "length").writable) {
          throw new $TypeError("Cannot set read only .length");
        }
        return O.length = length;
      } : function(O, length) {
        return O.length = length;
      };
    })
  ),
  /***/
  7680: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      module.exports = uncurryThis([].slice);
    })
  ),
  /***/
  7628: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var lengthOfArrayLike = __webpack_require__2(6198);
      module.exports = function(O, C) {
        var len = lengthOfArrayLike(O);
        var A = new C(len);
        var k = 0;
        for (; k < len; k++) A[k] = O[len - k - 1];
        return A;
      };
    })
  ),
  /***/
  9928: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var lengthOfArrayLike = __webpack_require__2(6198);
      var toIntegerOrInfinity = __webpack_require__2(1291);
      var $RangeError = RangeError;
      module.exports = function(O, C, index, value) {
        var len = lengthOfArrayLike(O);
        var relativeIndex = toIntegerOrInfinity(index);
        var actualIndex = relativeIndex < 0 ? len + relativeIndex : relativeIndex;
        if (actualIndex >= len || actualIndex < 0) throw new $RangeError("Incorrect index");
        var A = new C(len);
        var k = 0;
        for (; k < len; k++) A[k] = k === actualIndex ? value : O[k];
        return A;
      };
    })
  ),
  /***/
  6319: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var anObject = __webpack_require__2(8551);
      var iteratorClose = __webpack_require__2(9539);
      module.exports = function(iterator, fn, value, ENTRIES) {
        try {
          return ENTRIES ? fn(anObject(value)[0], value[1]) : fn(value);
        } catch (error) {
          iteratorClose(iterator, "throw", error);
        }
      };
    })
  ),
  /***/
  2195: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var toString = uncurryThis({}.toString);
      var stringSlice = uncurryThis("".slice);
      module.exports = function(it) {
        return stringSlice(toString(it), 8, -1);
      };
    })
  ),
  /***/
  6955: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var TO_STRING_TAG_SUPPORT = __webpack_require__2(2140);
      var isCallable = __webpack_require__2(4901);
      var classofRaw = __webpack_require__2(2195);
      var wellKnownSymbol = __webpack_require__2(8227);
      var TO_STRING_TAG = wellKnownSymbol("toStringTag");
      var $Object = Object;
      var CORRECT_ARGUMENTS = classofRaw(/* @__PURE__ */ (function() {
        return arguments;
      })()) === "Arguments";
      var tryGet = function(it, key) {
        try {
          return it[key];
        } catch (error) {
        }
      };
      module.exports = TO_STRING_TAG_SUPPORT ? classofRaw : function(it) {
        var O, tag, result;
        return it === void 0 ? "Undefined" : it === null ? "Null" : typeof (tag = tryGet(O = $Object(it), TO_STRING_TAG)) == "string" ? tag : CORRECT_ARGUMENTS ? classofRaw(O) : (result = classofRaw(O)) === "Object" && isCallable(O.callee) ? "Arguments" : result;
      };
    })
  ),
  /***/
  7740: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var hasOwn = __webpack_require__2(9297);
      var ownKeys = __webpack_require__2(5031);
      var getOwnPropertyDescriptorModule = __webpack_require__2(7347);
      var definePropertyModule = __webpack_require__2(4913);
      module.exports = function(target, source, exceptions) {
        var keys = ownKeys(source);
        var defineProperty = definePropertyModule.f;
        var getOwnPropertyDescriptor = getOwnPropertyDescriptorModule.f;
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          if (!hasOwn(target, key) && !(exceptions && hasOwn(exceptions, key))) {
            defineProperty(target, key, getOwnPropertyDescriptor(source, key));
          }
        }
      };
    })
  ),
  /***/
  2211: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var fails = __webpack_require__2(9039);
      module.exports = !fails(function() {
        function F() {
        }
        F.prototype.constructor = null;
        return Object.getPrototypeOf(new F()) !== F.prototype;
      });
    })
  ),
  /***/
  2529: (
    /***/
    ((module) => {
      module.exports = function(value, done) {
        return { value, done };
      };
    })
  ),
  /***/
  6699: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var definePropertyModule = __webpack_require__2(4913);
      var createPropertyDescriptor = __webpack_require__2(6980);
      module.exports = DESCRIPTORS ? function(object, key, value) {
        return definePropertyModule.f(object, key, createPropertyDescriptor(1, value));
      } : function(object, key, value) {
        object[key] = value;
        return object;
      };
    })
  ),
  /***/
  6980: (
    /***/
    ((module) => {
      module.exports = function(bitmap, value) {
        return {
          enumerable: !(bitmap & 1),
          configurable: !(bitmap & 2),
          writable: !(bitmap & 4),
          value
        };
      };
    })
  ),
  /***/
  4659: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var definePropertyModule = __webpack_require__2(4913);
      var createPropertyDescriptor = __webpack_require__2(6980);
      module.exports = function(object, key, value) {
        if (DESCRIPTORS) definePropertyModule.f(object, key, createPropertyDescriptor(0, value));
        else object[key] = value;
      };
    })
  ),
  /***/
  2106: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var makeBuiltIn = __webpack_require__2(283);
      var defineProperty = __webpack_require__2(4913);
      module.exports = function(target, name, descriptor) {
        if (descriptor.get) makeBuiltIn(descriptor.get, name, { getter: true });
        if (descriptor.set) makeBuiltIn(descriptor.set, name, { setter: true });
        return defineProperty.f(target, name, descriptor);
      };
    })
  ),
  /***/
  6840: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isCallable = __webpack_require__2(4901);
      var definePropertyModule = __webpack_require__2(4913);
      var makeBuiltIn = __webpack_require__2(283);
      var defineGlobalProperty = __webpack_require__2(9433);
      module.exports = function(O, key, value, options) {
        if (!options) options = {};
        var simple = options.enumerable;
        var name = options.name !== void 0 ? options.name : key;
        if (isCallable(value)) makeBuiltIn(value, name, options);
        if (options.global) {
          if (simple) O[key] = value;
          else defineGlobalProperty(key, value);
        } else {
          try {
            if (!options.unsafe) delete O[key];
            else if (O[key]) simple = true;
          } catch (error) {
          }
          if (simple) O[key] = value;
          else definePropertyModule.f(O, key, {
            value,
            enumerable: false,
            configurable: !options.nonConfigurable,
            writable: !options.nonWritable
          });
        }
        return O;
      };
    })
  ),
  /***/
  6279: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var defineBuiltIn = __webpack_require__2(6840);
      module.exports = function(target, src, options) {
        for (var key in src) defineBuiltIn(target, key, src[key], options);
        return target;
      };
    })
  ),
  /***/
  9433: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var defineProperty = Object.defineProperty;
      module.exports = function(key, value) {
        try {
          defineProperty(globalThis2, key, { value, configurable: true, writable: true });
        } catch (error) {
          globalThis2[key] = value;
        }
        return value;
      };
    })
  ),
  /***/
  3724: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var fails = __webpack_require__2(9039);
      module.exports = !fails(function() {
        return Object.defineProperty({}, 1, { get: function() {
          return 7;
        } })[1] !== 7;
      });
    })
  ),
  /***/
  4483: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var getBuiltInNodeModule = __webpack_require__2(9429);
      var PROPER_STRUCTURED_CLONE_TRANSFER = __webpack_require__2(1548);
      var structuredClone2 = globalThis2.structuredClone;
      var $ArrayBuffer = globalThis2.ArrayBuffer;
      var $MessageChannel = globalThis2.MessageChannel;
      var detach = false;
      var WorkerThreads, channel, buffer, $detach;
      if (PROPER_STRUCTURED_CLONE_TRANSFER) {
        detach = function(transferable) {
          structuredClone2(transferable, { transfer: [transferable] });
        };
      } else if ($ArrayBuffer) try {
        if (!$MessageChannel) {
          WorkerThreads = getBuiltInNodeModule("worker_threads");
          if (WorkerThreads) $MessageChannel = WorkerThreads.MessageChannel;
        }
        if ($MessageChannel) {
          channel = new $MessageChannel();
          buffer = new $ArrayBuffer(2);
          $detach = function(transferable) {
            channel.port1.postMessage(null, [transferable]);
          };
          if (buffer.byteLength === 2) {
            $detach(buffer);
            if (buffer.byteLength === 0) detach = $detach;
          }
        }
      } catch (error) {
      }
      module.exports = detach;
    })
  ),
  /***/
  4055: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var isObject = __webpack_require__2(34);
      var document2 = globalThis2.document;
      var EXISTS = isObject(document2) && isObject(document2.createElement);
      module.exports = function(it) {
        return EXISTS ? document2.createElement(it) : {};
      };
    })
  ),
  /***/
  6837: (
    /***/
    ((module) => {
      var $TypeError = TypeError;
      var MAX_SAFE_INTEGER = 9007199254740991;
      module.exports = function(it) {
        if (it > MAX_SAFE_INTEGER) throw $TypeError("Maximum allowed index exceeded");
        return it;
      };
    })
  ),
  /***/
  5002: (
    /***/
    ((module) => {
      module.exports = {
        IndexSizeError: { s: "INDEX_SIZE_ERR", c: 1, m: 1 },
        DOMStringSizeError: { s: "DOMSTRING_SIZE_ERR", c: 2, m: 0 },
        HierarchyRequestError: { s: "HIERARCHY_REQUEST_ERR", c: 3, m: 1 },
        WrongDocumentError: { s: "WRONG_DOCUMENT_ERR", c: 4, m: 1 },
        InvalidCharacterError: { s: "INVALID_CHARACTER_ERR", c: 5, m: 1 },
        NoDataAllowedError: { s: "NO_DATA_ALLOWED_ERR", c: 6, m: 0 },
        NoModificationAllowedError: { s: "NO_MODIFICATION_ALLOWED_ERR", c: 7, m: 1 },
        NotFoundError: { s: "NOT_FOUND_ERR", c: 8, m: 1 },
        NotSupportedError: { s: "NOT_SUPPORTED_ERR", c: 9, m: 1 },
        InUseAttributeError: { s: "INUSE_ATTRIBUTE_ERR", c: 10, m: 1 },
        InvalidStateError: { s: "INVALID_STATE_ERR", c: 11, m: 1 },
        SyntaxError: { s: "SYNTAX_ERR", c: 12, m: 1 },
        InvalidModificationError: { s: "INVALID_MODIFICATION_ERR", c: 13, m: 1 },
        NamespaceError: { s: "NAMESPACE_ERR", c: 14, m: 1 },
        InvalidAccessError: { s: "INVALID_ACCESS_ERR", c: 15, m: 1 },
        ValidationError: { s: "VALIDATION_ERR", c: 16, m: 0 },
        TypeMismatchError: { s: "TYPE_MISMATCH_ERR", c: 17, m: 1 },
        SecurityError: { s: "SECURITY_ERR", c: 18, m: 1 },
        NetworkError: { s: "NETWORK_ERR", c: 19, m: 1 },
        AbortError: { s: "ABORT_ERR", c: 20, m: 1 },
        URLMismatchError: { s: "URL_MISMATCH_ERR", c: 21, m: 1 },
        QuotaExceededError: { s: "QUOTA_EXCEEDED_ERR", c: 22, m: 1 },
        TimeoutError: { s: "TIMEOUT_ERR", c: 23, m: 1 },
        InvalidNodeTypeError: { s: "INVALID_NODE_TYPE_ERR", c: 24, m: 1 },
        DataCloneError: { s: "DATA_CLONE_ERR", c: 25, m: 1 }
      };
    })
  ),
  /***/
  8727: (
    /***/
    ((module) => {
      module.exports = [
        "constructor",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toLocaleString",
        "toString",
        "valueOf"
      ];
    })
  ),
  /***/
  6193: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var ENVIRONMENT = __webpack_require__2(4215);
      module.exports = ENVIRONMENT === "NODE";
    })
  ),
  /***/
  2839: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var navigator2 = globalThis2.navigator;
      var userAgent = navigator2 && navigator2.userAgent;
      module.exports = userAgent ? String(userAgent) : "";
    })
  ),
  /***/
  9519: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var userAgent = __webpack_require__2(2839);
      var process2 = globalThis2.process;
      var Deno2 = globalThis2.Deno;
      var versions = process2 && process2.versions || Deno2 && Deno2.version;
      var v8 = versions && versions.v8;
      var match, version2;
      if (v8) {
        match = v8.split(".");
        version2 = match[0] > 0 && match[0] < 4 ? 1 : +(match[0] + match[1]);
      }
      if (!version2 && userAgent) {
        match = userAgent.match(/Edge\/(\d+)/);
        if (!match || match[1] >= 74) {
          match = userAgent.match(/Chrome\/(\d+)/);
          if (match) version2 = +match[1];
        }
      }
      module.exports = version2;
    })
  ),
  /***/
  4215: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var userAgent = __webpack_require__2(2839);
      var classof = __webpack_require__2(2195);
      var userAgentStartsWith = function(string) {
        return userAgent.slice(0, string.length) === string;
      };
      module.exports = (function() {
        if (userAgentStartsWith("Bun/")) return "BUN";
        if (userAgentStartsWith("Cloudflare-Workers")) return "CLOUDFLARE";
        if (userAgentStartsWith("Deno/")) return "DENO";
        if (userAgentStartsWith("Node.js/")) return "NODE";
        if (globalThis2.Bun && typeof Bun.version == "string") return "BUN";
        if (globalThis2.Deno && typeof Deno.version == "object") return "DENO";
        if (classof(globalThis2.process) === "process") return "NODE";
        if (globalThis2.window && globalThis2.document) return "BROWSER";
        return "REST";
      })();
    })
  ),
  /***/
  8574: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var $Error = Error;
      var replace = uncurryThis("".replace);
      var TEST = (function(arg) {
        return String(new $Error(arg).stack);
      })("zxcasd");
      var V8_OR_CHAKRA_STACK_ENTRY = /\n\s*at [^:]*:[^\n]*/;
      var IS_V8_OR_CHAKRA_STACK = V8_OR_CHAKRA_STACK_ENTRY.test(TEST);
      module.exports = function(stack, dropEntries) {
        if (IS_V8_OR_CHAKRA_STACK && typeof stack == "string" && !$Error.prepareStackTrace) {
          while (dropEntries--) stack = replace(stack, V8_OR_CHAKRA_STACK_ENTRY, "");
        }
        return stack;
      };
    })
  ),
  /***/
  6518: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var getOwnPropertyDescriptor = __webpack_require__2(7347).f;
      var createNonEnumerableProperty = __webpack_require__2(6699);
      var defineBuiltIn = __webpack_require__2(6840);
      var defineGlobalProperty = __webpack_require__2(9433);
      var copyConstructorProperties = __webpack_require__2(7740);
      var isForced = __webpack_require__2(2796);
      module.exports = function(options, source) {
        var TARGET = options.target;
        var GLOBAL = options.global;
        var STATIC = options.stat;
        var FORCED, target, key, targetProperty, sourceProperty, descriptor;
        if (GLOBAL) {
          target = globalThis2;
        } else if (STATIC) {
          target = globalThis2[TARGET] || defineGlobalProperty(TARGET, {});
        } else {
          target = globalThis2[TARGET] && globalThis2[TARGET].prototype;
        }
        if (target) for (key in source) {
          sourceProperty = source[key];
          if (options.dontCallGetSet) {
            descriptor = getOwnPropertyDescriptor(target, key);
            targetProperty = descriptor && descriptor.value;
          } else targetProperty = target[key];
          FORCED = isForced(GLOBAL ? key : TARGET + (STATIC ? "." : "#") + key, options.forced);
          if (!FORCED && targetProperty !== void 0) {
            if (typeof sourceProperty == typeof targetProperty) continue;
            copyConstructorProperties(sourceProperty, targetProperty);
          }
          if (options.sham || targetProperty && targetProperty.sham) {
            createNonEnumerableProperty(sourceProperty, "sham", true);
          }
          defineBuiltIn(target, key, sourceProperty, options);
        }
      };
    })
  ),
  /***/
  9039: (
    /***/
    ((module) => {
      module.exports = function(exec) {
        try {
          return !!exec();
        } catch (error) {
          return true;
        }
      };
    })
  ),
  /***/
  8745: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var NATIVE_BIND = __webpack_require__2(616);
      var FunctionPrototype = Function.prototype;
      var apply = FunctionPrototype.apply;
      var call = FunctionPrototype.call;
      module.exports = typeof Reflect == "object" && Reflect.apply || (NATIVE_BIND ? call.bind(apply) : function() {
        return call.apply(apply, arguments);
      });
    })
  ),
  /***/
  6080: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(7476);
      var aCallable = __webpack_require__2(9306);
      var NATIVE_BIND = __webpack_require__2(616);
      var bind = uncurryThis(uncurryThis.bind);
      module.exports = function(fn, that) {
        aCallable(fn);
        return that === void 0 ? fn : NATIVE_BIND ? bind(fn, that) : function() {
          return fn.apply(that, arguments);
        };
      };
    })
  ),
  /***/
  616: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var fails = __webpack_require__2(9039);
      module.exports = !fails(function() {
        var test = (function() {
        }).bind();
        return typeof test != "function" || test.hasOwnProperty("prototype");
      });
    })
  ),
  /***/
  9565: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var NATIVE_BIND = __webpack_require__2(616);
      var call = Function.prototype.call;
      module.exports = NATIVE_BIND ? call.bind(call) : function() {
        return call.apply(call, arguments);
      };
    })
  ),
  /***/
  350: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var hasOwn = __webpack_require__2(9297);
      var FunctionPrototype = Function.prototype;
      var getDescriptor = DESCRIPTORS && Object.getOwnPropertyDescriptor;
      var EXISTS = hasOwn(FunctionPrototype, "name");
      var PROPER = EXISTS && (function something() {
      }).name === "something";
      var CONFIGURABLE = EXISTS && (!DESCRIPTORS || DESCRIPTORS && getDescriptor(FunctionPrototype, "name").configurable);
      module.exports = {
        EXISTS,
        PROPER,
        CONFIGURABLE
      };
    })
  ),
  /***/
  6706: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var aCallable = __webpack_require__2(9306);
      module.exports = function(object, key, method) {
        try {
          return uncurryThis(aCallable(Object.getOwnPropertyDescriptor(object, key)[method]));
        } catch (error) {
        }
      };
    })
  ),
  /***/
  7476: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var classofRaw = __webpack_require__2(2195);
      var uncurryThis = __webpack_require__2(9504);
      module.exports = function(fn) {
        if (classofRaw(fn) === "Function") return uncurryThis(fn);
      };
    })
  ),
  /***/
  9504: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var NATIVE_BIND = __webpack_require__2(616);
      var FunctionPrototype = Function.prototype;
      var call = FunctionPrototype.call;
      var uncurryThisWithBind = NATIVE_BIND && FunctionPrototype.bind.bind(call, call);
      module.exports = NATIVE_BIND ? uncurryThisWithBind : function(fn) {
        return function() {
          return call.apply(fn, arguments);
        };
      };
    })
  ),
  /***/
  9429: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var IS_NODE = __webpack_require__2(6193);
      module.exports = function(name) {
        if (IS_NODE) {
          try {
            return globalThis2.process.getBuiltinModule(name);
          } catch (error) {
          }
          try {
            return Function('return require("' + name + '")')();
          } catch (error) {
          }
        }
      };
    })
  ),
  /***/
  7751: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var isCallable = __webpack_require__2(4901);
      var aFunction = function(argument) {
        return isCallable(argument) ? argument : void 0;
      };
      module.exports = function(namespace, method) {
        return arguments.length < 2 ? aFunction(globalThis2[namespace]) : globalThis2[namespace] && globalThis2[namespace][method];
      };
    })
  ),
  /***/
  1767: (
    /***/
    ((module) => {
      module.exports = function(obj) {
        return {
          iterator: obj,
          next: obj.next,
          done: false
        };
      };
    })
  ),
  /***/
  8646: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var call = __webpack_require__2(9565);
      var anObject = __webpack_require__2(8551);
      var getIteratorDirect = __webpack_require__2(1767);
      var getIteratorMethod = __webpack_require__2(851);
      module.exports = function(obj, stringHandling) {
        if (!stringHandling || typeof obj !== "string") anObject(obj);
        var method = getIteratorMethod(obj);
        return getIteratorDirect(anObject(method !== void 0 ? call(method, obj) : obj));
      };
    })
  ),
  /***/
  851: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var classof = __webpack_require__2(6955);
      var getMethod = __webpack_require__2(5966);
      var isNullOrUndefined = __webpack_require__2(4117);
      var Iterators = __webpack_require__2(6269);
      var wellKnownSymbol = __webpack_require__2(8227);
      var ITERATOR = wellKnownSymbol("iterator");
      module.exports = function(it) {
        if (!isNullOrUndefined(it)) return getMethod(it, ITERATOR) || getMethod(it, "@@iterator") || Iterators[classof(it)];
      };
    })
  ),
  /***/
  81: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var call = __webpack_require__2(9565);
      var aCallable = __webpack_require__2(9306);
      var anObject = __webpack_require__2(8551);
      var tryToString = __webpack_require__2(6823);
      var getIteratorMethod = __webpack_require__2(851);
      var $TypeError = TypeError;
      module.exports = function(argument, usingIterator) {
        var iteratorMethod = arguments.length < 2 ? getIteratorMethod(argument) : usingIterator;
        if (aCallable(iteratorMethod)) return anObject(call(iteratorMethod, argument));
        throw new $TypeError(tryToString(argument) + " is not iterable");
      };
    })
  ),
  /***/
  5966: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aCallable = __webpack_require__2(9306);
      var isNullOrUndefined = __webpack_require__2(4117);
      module.exports = function(V, P) {
        var func = V[P];
        return isNullOrUndefined(func) ? void 0 : aCallable(func);
      };
    })
  ),
  /***/
  3789: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aCallable = __webpack_require__2(9306);
      var anObject = __webpack_require__2(8551);
      var call = __webpack_require__2(9565);
      var toIntegerOrInfinity = __webpack_require__2(1291);
      var getIteratorDirect = __webpack_require__2(1767);
      var INVALID_SIZE = "Invalid size";
      var $RangeError = RangeError;
      var $TypeError = TypeError;
      var max = Math.max;
      var SetRecord = function(set, intSize) {
        this.set = set;
        this.size = max(intSize, 0);
        this.has = aCallable(set.has);
        this.keys = aCallable(set.keys);
      };
      SetRecord.prototype = {
        getIterator: function() {
          return getIteratorDirect(anObject(call(this.keys, this.set)));
        },
        includes: function(it) {
          return call(this.has, this.set, it);
        }
      };
      module.exports = function(obj) {
        anObject(obj);
        var numSize = +obj.size;
        if (numSize !== numSize) throw new $TypeError(INVALID_SIZE);
        var intSize = toIntegerOrInfinity(numSize);
        if (intSize < 0) throw new $RangeError(INVALID_SIZE);
        return new SetRecord(obj, intSize);
      };
    })
  ),
  /***/
  4576: (
    /***/
    (function(module) {
      var check = function(it) {
        return it && it.Math === Math && it;
      };
      module.exports = // eslint-disable-next-line es/no-global-this -- safe
      check(typeof globalThis == "object" && globalThis) || check(typeof window == "object" && window) || // eslint-disable-next-line no-restricted-globals -- safe
      check(typeof self == "object" && self) || check(typeof global == "object" && global) || check(typeof this == "object" && this) || // eslint-disable-next-line no-new-func -- fallback
      /* @__PURE__ */ (function() {
        return this;
      })() || Function("return this")();
    })
  ),
  /***/
  9297: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var toObject = __webpack_require__2(8981);
      var hasOwnProperty = uncurryThis({}.hasOwnProperty);
      module.exports = Object.hasOwn || function hasOwn(it, key) {
        return hasOwnProperty(toObject(it), key);
      };
    })
  ),
  /***/
  421: (
    /***/
    ((module) => {
      module.exports = {};
    })
  ),
  /***/
  397: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var getBuiltIn = __webpack_require__2(7751);
      module.exports = getBuiltIn("document", "documentElement");
    })
  ),
  /***/
  5917: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var fails = __webpack_require__2(9039);
      var createElement = __webpack_require__2(4055);
      module.exports = !DESCRIPTORS && !fails(function() {
        return Object.defineProperty(createElement("div"), "a", {
          get: function() {
            return 7;
          }
        }).a !== 7;
      });
    })
  ),
  /***/
  7055: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var fails = __webpack_require__2(9039);
      var classof = __webpack_require__2(2195);
      var $Object = Object;
      var split = uncurryThis("".split);
      module.exports = fails(function() {
        return !$Object("z").propertyIsEnumerable(0);
      }) ? function(it) {
        return classof(it) === "String" ? split(it, "") : $Object(it);
      } : $Object;
    })
  ),
  /***/
  3167: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isCallable = __webpack_require__2(4901);
      var isObject = __webpack_require__2(34);
      var setPrototypeOf = __webpack_require__2(2967);
      module.exports = function($this, dummy, Wrapper) {
        var NewTarget, NewTargetPrototype;
        if (
          // it can work only with native `setPrototypeOf`
          setPrototypeOf && // we haven't completely correct pre-ES6 way for getting `new.target`, so use this
          isCallable(NewTarget = dummy.constructor) && NewTarget !== Wrapper && isObject(NewTargetPrototype = NewTarget.prototype) && NewTargetPrototype !== Wrapper.prototype
        ) setPrototypeOf($this, NewTargetPrototype);
        return $this;
      };
    })
  ),
  /***/
  3706: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var isCallable = __webpack_require__2(4901);
      var store = __webpack_require__2(7629);
      var functionToString = uncurryThis(Function.toString);
      if (!isCallable(store.inspectSource)) {
        store.inspectSource = function(it) {
          return functionToString(it);
        };
      }
      module.exports = store.inspectSource;
    })
  ),
  /***/
  1181: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var NATIVE_WEAK_MAP = __webpack_require__2(8622);
      var globalThis2 = __webpack_require__2(4576);
      var isObject = __webpack_require__2(34);
      var createNonEnumerableProperty = __webpack_require__2(6699);
      var hasOwn = __webpack_require__2(9297);
      var shared = __webpack_require__2(7629);
      var sharedKey = __webpack_require__2(6119);
      var hiddenKeys = __webpack_require__2(421);
      var OBJECT_ALREADY_INITIALIZED = "Object already initialized";
      var TypeError2 = globalThis2.TypeError;
      var WeakMap2 = globalThis2.WeakMap;
      var set, get, has;
      var enforce = function(it) {
        return has(it) ? get(it) : set(it, {});
      };
      var getterFor = function(TYPE) {
        return function(it) {
          var state;
          if (!isObject(it) || (state = get(it)).type !== TYPE) {
            throw new TypeError2("Incompatible receiver, " + TYPE + " required");
          }
          return state;
        };
      };
      if (NATIVE_WEAK_MAP || shared.state) {
        var store = shared.state || (shared.state = new WeakMap2());
        store.get = store.get;
        store.has = store.has;
        store.set = store.set;
        set = function(it, metadata) {
          if (store.has(it)) throw new TypeError2(OBJECT_ALREADY_INITIALIZED);
          metadata.facade = it;
          store.set(it, metadata);
          return metadata;
        };
        get = function(it) {
          return store.get(it) || {};
        };
        has = function(it) {
          return store.has(it);
        };
      } else {
        var STATE = sharedKey("state");
        hiddenKeys[STATE] = true;
        set = function(it, metadata) {
          if (hasOwn(it, STATE)) throw new TypeError2(OBJECT_ALREADY_INITIALIZED);
          metadata.facade = it;
          createNonEnumerableProperty(it, STATE, metadata);
          return metadata;
        };
        get = function(it) {
          return hasOwn(it, STATE) ? it[STATE] : {};
        };
        has = function(it) {
          return hasOwn(it, STATE);
        };
      }
      module.exports = {
        set,
        get,
        has,
        enforce,
        getterFor
      };
    })
  ),
  /***/
  4209: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var wellKnownSymbol = __webpack_require__2(8227);
      var Iterators = __webpack_require__2(6269);
      var ITERATOR = wellKnownSymbol("iterator");
      var ArrayPrototype = Array.prototype;
      module.exports = function(it) {
        return it !== void 0 && (Iterators.Array === it || ArrayPrototype[ITERATOR] === it);
      };
    })
  ),
  /***/
  4376: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var classof = __webpack_require__2(2195);
      module.exports = Array.isArray || function isArray(argument) {
        return classof(argument) === "Array";
      };
    })
  ),
  /***/
  1108: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var classof = __webpack_require__2(6955);
      module.exports = function(it) {
        var klass = classof(it);
        return klass === "BigInt64Array" || klass === "BigUint64Array";
      };
    })
  ),
  /***/
  4901: (
    /***/
    ((module) => {
      var documentAll = typeof document == "object" && document.all;
      module.exports = typeof documentAll == "undefined" && documentAll !== void 0 ? function(argument) {
        return typeof argument == "function" || argument === documentAll;
      } : function(argument) {
        return typeof argument == "function";
      };
    })
  ),
  /***/
  2796: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var fails = __webpack_require__2(9039);
      var isCallable = __webpack_require__2(4901);
      var replacement = /#|\.prototype\./;
      var isForced = function(feature, detection) {
        var value = data[normalize(feature)];
        return value === POLYFILL ? true : value === NATIVE ? false : isCallable(detection) ? fails(detection) : !!detection;
      };
      var normalize = isForced.normalize = function(string) {
        return String(string).replace(replacement, ".").toLowerCase();
      };
      var data = isForced.data = {};
      var NATIVE = isForced.NATIVE = "N";
      var POLYFILL = isForced.POLYFILL = "P";
      module.exports = isForced;
    })
  ),
  /***/
  4117: (
    /***/
    ((module) => {
      module.exports = function(it) {
        return it === null || it === void 0;
      };
    })
  ),
  /***/
  34: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isCallable = __webpack_require__2(4901);
      module.exports = function(it) {
        return typeof it == "object" ? it !== null : isCallable(it);
      };
    })
  ),
  /***/
  3925: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isObject = __webpack_require__2(34);
      module.exports = function(argument) {
        return isObject(argument) || argument === null;
      };
    })
  ),
  /***/
  6395: (
    /***/
    ((module) => {
      module.exports = false;
    })
  ),
  /***/
  757: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var getBuiltIn = __webpack_require__2(7751);
      var isCallable = __webpack_require__2(4901);
      var isPrototypeOf = __webpack_require__2(1625);
      var USE_SYMBOL_AS_UID = __webpack_require__2(7040);
      var $Object = Object;
      module.exports = USE_SYMBOL_AS_UID ? function(it) {
        return typeof it == "symbol";
      } : function(it) {
        var $Symbol = getBuiltIn("Symbol");
        return isCallable($Symbol) && isPrototypeOf($Symbol.prototype, $Object(it));
      };
    })
  ),
  /***/
  507: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var call = __webpack_require__2(9565);
      module.exports = function(record, fn, ITERATOR_INSTEAD_OF_RECORD) {
        var iterator = ITERATOR_INSTEAD_OF_RECORD ? record : record.iterator;
        var next = record.next;
        var step, result;
        while (!(step = call(next, iterator)).done) {
          result = fn(step.value);
          if (result !== void 0) return result;
        }
      };
    })
  ),
  /***/
  2652: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var bind = __webpack_require__2(6080);
      var call = __webpack_require__2(9565);
      var anObject = __webpack_require__2(8551);
      var tryToString = __webpack_require__2(6823);
      var isArrayIteratorMethod = __webpack_require__2(4209);
      var lengthOfArrayLike = __webpack_require__2(6198);
      var isPrototypeOf = __webpack_require__2(1625);
      var getIterator = __webpack_require__2(81);
      var getIteratorMethod = __webpack_require__2(851);
      var iteratorClose = __webpack_require__2(9539);
      var $TypeError = TypeError;
      var Result = function(stopped, result) {
        this.stopped = stopped;
        this.result = result;
      };
      var ResultPrototype = Result.prototype;
      module.exports = function(iterable, unboundFunction, options) {
        var that = options && options.that;
        var AS_ENTRIES = !!(options && options.AS_ENTRIES);
        var IS_RECORD = !!(options && options.IS_RECORD);
        var IS_ITERATOR = !!(options && options.IS_ITERATOR);
        var INTERRUPTED = !!(options && options.INTERRUPTED);
        var fn = bind(unboundFunction, that);
        var iterator, iterFn, index, length, result, next, step;
        var stop = function(condition) {
          if (iterator) iteratorClose(iterator, "normal", condition);
          return new Result(true, condition);
        };
        var callFn = function(value) {
          if (AS_ENTRIES) {
            anObject(value);
            return INTERRUPTED ? fn(value[0], value[1], stop) : fn(value[0], value[1]);
          }
          return INTERRUPTED ? fn(value, stop) : fn(value);
        };
        if (IS_RECORD) {
          iterator = iterable.iterator;
        } else if (IS_ITERATOR) {
          iterator = iterable;
        } else {
          iterFn = getIteratorMethod(iterable);
          if (!iterFn) throw new $TypeError(tryToString(iterable) + " is not iterable");
          if (isArrayIteratorMethod(iterFn)) {
            for (index = 0, length = lengthOfArrayLike(iterable); length > index; index++) {
              result = callFn(iterable[index]);
              if (result && isPrototypeOf(ResultPrototype, result)) return result;
            }
            return new Result(false);
          }
          iterator = getIterator(iterable, iterFn);
        }
        next = IS_RECORD ? iterable.next : iterator.next;
        while (!(step = call(next, iterator)).done) {
          try {
            result = callFn(step.value);
          } catch (error) {
            iteratorClose(iterator, "throw", error);
          }
          if (typeof result == "object" && result && isPrototypeOf(ResultPrototype, result)) return result;
        }
        return new Result(false);
      };
    })
  ),
  /***/
  9539: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var call = __webpack_require__2(9565);
      var anObject = __webpack_require__2(8551);
      var getMethod = __webpack_require__2(5966);
      module.exports = function(iterator, kind, value) {
        var innerResult, innerError;
        anObject(iterator);
        try {
          innerResult = getMethod(iterator, "return");
          if (!innerResult) {
            if (kind === "throw") throw value;
            return value;
          }
          innerResult = call(innerResult, iterator);
        } catch (error) {
          innerError = true;
          innerResult = error;
        }
        if (kind === "throw") throw value;
        if (innerError) throw innerResult;
        anObject(innerResult);
        return value;
      };
    })
  ),
  /***/
  9462: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var call = __webpack_require__2(9565);
      var create = __webpack_require__2(2360);
      var createNonEnumerableProperty = __webpack_require__2(6699);
      var defineBuiltIns = __webpack_require__2(6279);
      var wellKnownSymbol = __webpack_require__2(8227);
      var InternalStateModule = __webpack_require__2(1181);
      var getMethod = __webpack_require__2(5966);
      var IteratorPrototype = __webpack_require__2(7657).IteratorPrototype;
      var createIterResultObject = __webpack_require__2(2529);
      var iteratorClose = __webpack_require__2(9539);
      var TO_STRING_TAG = wellKnownSymbol("toStringTag");
      var ITERATOR_HELPER = "IteratorHelper";
      var WRAP_FOR_VALID_ITERATOR = "WrapForValidIterator";
      var setInternalState = InternalStateModule.set;
      var createIteratorProxyPrototype = function(IS_ITERATOR) {
        var getInternalState = InternalStateModule.getterFor(IS_ITERATOR ? WRAP_FOR_VALID_ITERATOR : ITERATOR_HELPER);
        return defineBuiltIns(create(IteratorPrototype), {
          next: function next() {
            var state = getInternalState(this);
            if (IS_ITERATOR) return state.nextHandler();
            try {
              var result = state.done ? void 0 : state.nextHandler();
              return createIterResultObject(result, state.done);
            } catch (error) {
              state.done = true;
              throw error;
            }
          },
          "return": function() {
            var state = getInternalState(this);
            var iterator = state.iterator;
            state.done = true;
            if (IS_ITERATOR) {
              var returnMethod = getMethod(iterator, "return");
              return returnMethod ? call(returnMethod, iterator) : createIterResultObject(void 0, true);
            }
            if (state.inner) try {
              iteratorClose(state.inner.iterator, "normal");
            } catch (error) {
              return iteratorClose(iterator, "throw", error);
            }
            if (iterator) iteratorClose(iterator, "normal");
            return createIterResultObject(void 0, true);
          }
        });
      };
      var WrapForValidIteratorPrototype = createIteratorProxyPrototype(true);
      var IteratorHelperPrototype = createIteratorProxyPrototype(false);
      createNonEnumerableProperty(IteratorHelperPrototype, TO_STRING_TAG, "Iterator Helper");
      module.exports = function(nextHandler, IS_ITERATOR) {
        var IteratorProxy = function Iterator(record, state) {
          if (state) {
            state.iterator = record.iterator;
            state.next = record.next;
          } else state = record;
          state.type = IS_ITERATOR ? WRAP_FOR_VALID_ITERATOR : ITERATOR_HELPER;
          state.nextHandler = nextHandler;
          state.counter = 0;
          state.done = false;
          setInternalState(this, state);
        };
        IteratorProxy.prototype = IS_ITERATOR ? WrapForValidIteratorPrototype : IteratorHelperPrototype;
        return IteratorProxy;
      };
    })
  ),
  /***/
  713: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var call = __webpack_require__2(9565);
      var aCallable = __webpack_require__2(9306);
      var anObject = __webpack_require__2(8551);
      var getIteratorDirect = __webpack_require__2(1767);
      var createIteratorProxy = __webpack_require__2(9462);
      var callWithSafeIterationClosing = __webpack_require__2(6319);
      var IteratorProxy = createIteratorProxy(function() {
        var iterator = this.iterator;
        var result = anObject(call(this.next, iterator));
        var done = this.done = !!result.done;
        if (!done) return callWithSafeIterationClosing(iterator, this.mapper, [result.value, this.counter++], true);
      });
      module.exports = function map(mapper) {
        anObject(this);
        aCallable(mapper);
        return new IteratorProxy(getIteratorDirect(this), {
          mapper
        });
      };
    })
  ),
  /***/
  7657: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var fails = __webpack_require__2(9039);
      var isCallable = __webpack_require__2(4901);
      var isObject = __webpack_require__2(34);
      var create = __webpack_require__2(2360);
      var getPrototypeOf = __webpack_require__2(2787);
      var defineBuiltIn = __webpack_require__2(6840);
      var wellKnownSymbol = __webpack_require__2(8227);
      var IS_PURE = __webpack_require__2(6395);
      var ITERATOR = wellKnownSymbol("iterator");
      var BUGGY_SAFARI_ITERATORS = false;
      var IteratorPrototype, PrototypeOfArrayIteratorPrototype, arrayIterator;
      if ([].keys) {
        arrayIterator = [].keys();
        if (!("next" in arrayIterator)) BUGGY_SAFARI_ITERATORS = true;
        else {
          PrototypeOfArrayIteratorPrototype = getPrototypeOf(getPrototypeOf(arrayIterator));
          if (PrototypeOfArrayIteratorPrototype !== Object.prototype) IteratorPrototype = PrototypeOfArrayIteratorPrototype;
        }
      }
      var NEW_ITERATOR_PROTOTYPE = !isObject(IteratorPrototype) || fails(function() {
        var test = {};
        return IteratorPrototype[ITERATOR].call(test) !== test;
      });
      if (NEW_ITERATOR_PROTOTYPE) IteratorPrototype = {};
      else if (IS_PURE) IteratorPrototype = create(IteratorPrototype);
      if (!isCallable(IteratorPrototype[ITERATOR])) {
        defineBuiltIn(IteratorPrototype, ITERATOR, function() {
          return this;
        });
      }
      module.exports = {
        IteratorPrototype,
        BUGGY_SAFARI_ITERATORS
      };
    })
  ),
  /***/
  6269: (
    /***/
    ((module) => {
      module.exports = {};
    })
  ),
  /***/
  6198: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var toLength = __webpack_require__2(8014);
      module.exports = function(obj) {
        return toLength(obj.length);
      };
    })
  ),
  /***/
  283: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var fails = __webpack_require__2(9039);
      var isCallable = __webpack_require__2(4901);
      var hasOwn = __webpack_require__2(9297);
      var DESCRIPTORS = __webpack_require__2(3724);
      var CONFIGURABLE_FUNCTION_NAME = __webpack_require__2(350).CONFIGURABLE;
      var inspectSource = __webpack_require__2(3706);
      var InternalStateModule = __webpack_require__2(1181);
      var enforceInternalState = InternalStateModule.enforce;
      var getInternalState = InternalStateModule.get;
      var $String = String;
      var defineProperty = Object.defineProperty;
      var stringSlice = uncurryThis("".slice);
      var replace = uncurryThis("".replace);
      var join = uncurryThis([].join);
      var CONFIGURABLE_LENGTH = DESCRIPTORS && !fails(function() {
        return defineProperty(function() {
        }, "length", { value: 8 }).length !== 8;
      });
      var TEMPLATE = String(String).split("String");
      var makeBuiltIn = module.exports = function(value, name, options) {
        if (stringSlice($String(name), 0, 7) === "Symbol(") {
          name = "[" + replace($String(name), /^Symbol\(([^)]*)\).*$/, "$1") + "]";
        }
        if (options && options.getter) name = "get " + name;
        if (options && options.setter) name = "set " + name;
        if (!hasOwn(value, "name") || CONFIGURABLE_FUNCTION_NAME && value.name !== name) {
          if (DESCRIPTORS) defineProperty(value, "name", { value: name, configurable: true });
          else value.name = name;
        }
        if (CONFIGURABLE_LENGTH && options && hasOwn(options, "arity") && value.length !== options.arity) {
          defineProperty(value, "length", { value: options.arity });
        }
        try {
          if (options && hasOwn(options, "constructor") && options.constructor) {
            if (DESCRIPTORS) defineProperty(value, "prototype", { writable: false });
          } else if (value.prototype) value.prototype = void 0;
        } catch (error) {
        }
        var state = enforceInternalState(value);
        if (!hasOwn(state, "source")) {
          state.source = join(TEMPLATE, typeof name == "string" ? name : "");
        }
        return value;
      };
      Function.prototype.toString = makeBuiltIn(function toString() {
        return isCallable(this) && getInternalState(this).source || inspectSource(this);
      }, "toString");
    })
  ),
  /***/
  741: (
    /***/
    ((module) => {
      var ceil = Math.ceil;
      var floor = Math.floor;
      module.exports = Math.trunc || function trunc(x) {
        var n = +x;
        return (n > 0 ? floor : ceil)(n);
      };
    })
  ),
  /***/
  6043: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aCallable = __webpack_require__2(9306);
      var $TypeError = TypeError;
      var PromiseCapability = function(C) {
        var resolve, reject;
        this.promise = new C(function($$resolve, $$reject) {
          if (resolve !== void 0 || reject !== void 0) throw new $TypeError("Bad Promise constructor");
          resolve = $$resolve;
          reject = $$reject;
        });
        this.resolve = aCallable(resolve);
        this.reject = aCallable(reject);
      };
      module.exports.f = function(C) {
        return new PromiseCapability(C);
      };
    })
  ),
  /***/
  2603: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var toString = __webpack_require__2(655);
      module.exports = function(argument, $default) {
        return argument === void 0 ? arguments.length < 2 ? "" : $default : toString(argument);
      };
    })
  ),
  /***/
  4149: (
    /***/
    ((module) => {
      var $RangeError = RangeError;
      module.exports = function(it) {
        if (it === it) return it;
        throw new $RangeError("NaN is not allowed");
      };
    })
  ),
  /***/
  2360: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var anObject = __webpack_require__2(8551);
      var definePropertiesModule = __webpack_require__2(6801);
      var enumBugKeys = __webpack_require__2(8727);
      var hiddenKeys = __webpack_require__2(421);
      var html = __webpack_require__2(397);
      var documentCreateElement = __webpack_require__2(4055);
      var sharedKey = __webpack_require__2(6119);
      var GT = ">";
      var LT = "<";
      var PROTOTYPE = "prototype";
      var SCRIPT = "script";
      var IE_PROTO = sharedKey("IE_PROTO");
      var EmptyConstructor = function() {
      };
      var scriptTag = function(content) {
        return LT + SCRIPT + GT + content + LT + "/" + SCRIPT + GT;
      };
      var NullProtoObjectViaActiveX = function(activeXDocument2) {
        activeXDocument2.write(scriptTag(""));
        activeXDocument2.close();
        var temp = activeXDocument2.parentWindow.Object;
        activeXDocument2 = null;
        return temp;
      };
      var NullProtoObjectViaIFrame = function() {
        var iframe = documentCreateElement("iframe");
        var JS = "java" + SCRIPT + ":";
        var iframeDocument;
        iframe.style.display = "none";
        html.appendChild(iframe);
        iframe.src = String(JS);
        iframeDocument = iframe.contentWindow.document;
        iframeDocument.open();
        iframeDocument.write(scriptTag("document.F=Object"));
        iframeDocument.close();
        return iframeDocument.F;
      };
      var activeXDocument;
      var NullProtoObject = function() {
        try {
          activeXDocument = new ActiveXObject("htmlfile");
        } catch (error) {
        }
        NullProtoObject = typeof document != "undefined" ? document.domain && activeXDocument ? NullProtoObjectViaActiveX(activeXDocument) : NullProtoObjectViaIFrame() : NullProtoObjectViaActiveX(activeXDocument);
        var length = enumBugKeys.length;
        while (length--) delete NullProtoObject[PROTOTYPE][enumBugKeys[length]];
        return NullProtoObject();
      };
      hiddenKeys[IE_PROTO] = true;
      module.exports = Object.create || function create(O, Properties) {
        var result;
        if (O !== null) {
          EmptyConstructor[PROTOTYPE] = anObject(O);
          result = new EmptyConstructor();
          EmptyConstructor[PROTOTYPE] = null;
          result[IE_PROTO] = O;
        } else result = NullProtoObject();
        return Properties === void 0 ? result : definePropertiesModule.f(result, Properties);
      };
    })
  ),
  /***/
  6801: (
    /***/
    ((__unused_webpack_module, exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var V8_PROTOTYPE_DEFINE_BUG = __webpack_require__2(8686);
      var definePropertyModule = __webpack_require__2(4913);
      var anObject = __webpack_require__2(8551);
      var toIndexedObject = __webpack_require__2(5397);
      var objectKeys = __webpack_require__2(1072);
      exports.f = DESCRIPTORS && !V8_PROTOTYPE_DEFINE_BUG ? Object.defineProperties : function defineProperties(O, Properties) {
        anObject(O);
        var props = toIndexedObject(Properties);
        var keys = objectKeys(Properties);
        var length = keys.length;
        var index = 0;
        var key;
        while (length > index) definePropertyModule.f(O, key = keys[index++], props[key]);
        return O;
      };
    })
  ),
  /***/
  4913: (
    /***/
    ((__unused_webpack_module, exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var IE8_DOM_DEFINE = __webpack_require__2(5917);
      var V8_PROTOTYPE_DEFINE_BUG = __webpack_require__2(8686);
      var anObject = __webpack_require__2(8551);
      var toPropertyKey = __webpack_require__2(6969);
      var $TypeError = TypeError;
      var $defineProperty = Object.defineProperty;
      var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      var ENUMERABLE = "enumerable";
      var CONFIGURABLE = "configurable";
      var WRITABLE = "writable";
      exports.f = DESCRIPTORS ? V8_PROTOTYPE_DEFINE_BUG ? function defineProperty(O, P, Attributes) {
        anObject(O);
        P = toPropertyKey(P);
        anObject(Attributes);
        if (typeof O === "function" && P === "prototype" && "value" in Attributes && WRITABLE in Attributes && !Attributes[WRITABLE]) {
          var current = $getOwnPropertyDescriptor(O, P);
          if (current && current[WRITABLE]) {
            O[P] = Attributes.value;
            Attributes = {
              configurable: CONFIGURABLE in Attributes ? Attributes[CONFIGURABLE] : current[CONFIGURABLE],
              enumerable: ENUMERABLE in Attributes ? Attributes[ENUMERABLE] : current[ENUMERABLE],
              writable: false
            };
          }
        }
        return $defineProperty(O, P, Attributes);
      } : $defineProperty : function defineProperty(O, P, Attributes) {
        anObject(O);
        P = toPropertyKey(P);
        anObject(Attributes);
        if (IE8_DOM_DEFINE) try {
          return $defineProperty(O, P, Attributes);
        } catch (error) {
        }
        if ("get" in Attributes || "set" in Attributes) throw new $TypeError("Accessors not supported");
        if ("value" in Attributes) O[P] = Attributes.value;
        return O;
      };
    })
  ),
  /***/
  7347: (
    /***/
    ((__unused_webpack_module, exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var call = __webpack_require__2(9565);
      var propertyIsEnumerableModule = __webpack_require__2(8773);
      var createPropertyDescriptor = __webpack_require__2(6980);
      var toIndexedObject = __webpack_require__2(5397);
      var toPropertyKey = __webpack_require__2(6969);
      var hasOwn = __webpack_require__2(9297);
      var IE8_DOM_DEFINE = __webpack_require__2(5917);
      var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      exports.f = DESCRIPTORS ? $getOwnPropertyDescriptor : function getOwnPropertyDescriptor(O, P) {
        O = toIndexedObject(O);
        P = toPropertyKey(P);
        if (IE8_DOM_DEFINE) try {
          return $getOwnPropertyDescriptor(O, P);
        } catch (error) {
        }
        if (hasOwn(O, P)) return createPropertyDescriptor(!call(propertyIsEnumerableModule.f, O, P), O[P]);
      };
    })
  ),
  /***/
  8480: (
    /***/
    ((__unused_webpack_module, exports, __webpack_require__2) => {
      var internalObjectKeys = __webpack_require__2(1828);
      var enumBugKeys = __webpack_require__2(8727);
      var hiddenKeys = enumBugKeys.concat("length", "prototype");
      exports.f = Object.getOwnPropertyNames || function getOwnPropertyNames(O) {
        return internalObjectKeys(O, hiddenKeys);
      };
    })
  ),
  /***/
  3717: (
    /***/
    ((__unused_webpack_module, exports) => {
      exports.f = Object.getOwnPropertySymbols;
    })
  ),
  /***/
  2787: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var hasOwn = __webpack_require__2(9297);
      var isCallable = __webpack_require__2(4901);
      var toObject = __webpack_require__2(8981);
      var sharedKey = __webpack_require__2(6119);
      var CORRECT_PROTOTYPE_GETTER = __webpack_require__2(2211);
      var IE_PROTO = sharedKey("IE_PROTO");
      var $Object = Object;
      var ObjectPrototype = $Object.prototype;
      module.exports = CORRECT_PROTOTYPE_GETTER ? $Object.getPrototypeOf : function(O) {
        var object = toObject(O);
        if (hasOwn(object, IE_PROTO)) return object[IE_PROTO];
        var constructor = object.constructor;
        if (isCallable(constructor) && object instanceof constructor) {
          return constructor.prototype;
        }
        return object instanceof $Object ? ObjectPrototype : null;
      };
    })
  ),
  /***/
  1625: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      module.exports = uncurryThis({}.isPrototypeOf);
    })
  ),
  /***/
  1828: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var hasOwn = __webpack_require__2(9297);
      var toIndexedObject = __webpack_require__2(5397);
      var indexOf = __webpack_require__2(9617).indexOf;
      var hiddenKeys = __webpack_require__2(421);
      var push = uncurryThis([].push);
      module.exports = function(object, names) {
        var O = toIndexedObject(object);
        var i = 0;
        var result = [];
        var key;
        for (key in O) !hasOwn(hiddenKeys, key) && hasOwn(O, key) && push(result, key);
        while (names.length > i) if (hasOwn(O, key = names[i++])) {
          ~indexOf(result, key) || push(result, key);
        }
        return result;
      };
    })
  ),
  /***/
  1072: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var internalObjectKeys = __webpack_require__2(1828);
      var enumBugKeys = __webpack_require__2(8727);
      module.exports = Object.keys || function keys(O) {
        return internalObjectKeys(O, enumBugKeys);
      };
    })
  ),
  /***/
  8773: (
    /***/
    ((__unused_webpack_module, exports) => {
      var $propertyIsEnumerable = {}.propertyIsEnumerable;
      var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      var NASHORN_BUG = getOwnPropertyDescriptor && !$propertyIsEnumerable.call({ 1: 2 }, 1);
      exports.f = NASHORN_BUG ? function propertyIsEnumerable(V) {
        var descriptor = getOwnPropertyDescriptor(this, V);
        return !!descriptor && descriptor.enumerable;
      } : $propertyIsEnumerable;
    })
  ),
  /***/
  2967: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThisAccessor = __webpack_require__2(6706);
      var isObject = __webpack_require__2(34);
      var requireObjectCoercible = __webpack_require__2(7750);
      var aPossiblePrototype = __webpack_require__2(3506);
      module.exports = Object.setPrototypeOf || ("__proto__" in {} ? (function() {
        var CORRECT_SETTER = false;
        var test = {};
        var setter;
        try {
          setter = uncurryThisAccessor(Object.prototype, "__proto__", "set");
          setter(test, []);
          CORRECT_SETTER = test instanceof Array;
        } catch (error) {
        }
        return function setPrototypeOf(O, proto) {
          requireObjectCoercible(O);
          aPossiblePrototype(proto);
          if (!isObject(O)) return O;
          if (CORRECT_SETTER) setter(O, proto);
          else O.__proto__ = proto;
          return O;
        };
      })() : void 0);
    })
  ),
  /***/
  4270: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var call = __webpack_require__2(9565);
      var isCallable = __webpack_require__2(4901);
      var isObject = __webpack_require__2(34);
      var $TypeError = TypeError;
      module.exports = function(input, pref) {
        var fn, val;
        if (pref === "string" && isCallable(fn = input.toString) && !isObject(val = call(fn, input))) return val;
        if (isCallable(fn = input.valueOf) && !isObject(val = call(fn, input))) return val;
        if (pref !== "string" && isCallable(fn = input.toString) && !isObject(val = call(fn, input))) return val;
        throw new $TypeError("Can't convert object to primitive value");
      };
    })
  ),
  /***/
  5031: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var getBuiltIn = __webpack_require__2(7751);
      var uncurryThis = __webpack_require__2(9504);
      var getOwnPropertyNamesModule = __webpack_require__2(8480);
      var getOwnPropertySymbolsModule = __webpack_require__2(3717);
      var anObject = __webpack_require__2(8551);
      var concat = uncurryThis([].concat);
      module.exports = getBuiltIn("Reflect", "ownKeys") || function ownKeys(it) {
        var keys = getOwnPropertyNamesModule.f(anObject(it));
        var getOwnPropertySymbols = getOwnPropertySymbolsModule.f;
        return getOwnPropertySymbols ? concat(keys, getOwnPropertySymbols(it)) : keys;
      };
    })
  ),
  /***/
  8235: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var hasOwn = __webpack_require__2(9297);
      var $SyntaxError = SyntaxError;
      var $parseInt = parseInt;
      var fromCharCode = String.fromCharCode;
      var at = uncurryThis("".charAt);
      var slice = uncurryThis("".slice);
      var exec = uncurryThis(/./.exec);
      var codePoints = {
        '\\"': '"',
        "\\\\": "\\",
        "\\/": "/",
        "\\b": "\b",
        "\\f": "\f",
        "\\n": "\n",
        "\\r": "\r",
        "\\t": "	"
      };
      var IS_4_HEX_DIGITS = /^[\da-f]{4}$/i;
      var IS_C0_CONTROL_CODE = /^[\u0000-\u001F]$/;
      module.exports = function(source, i) {
        var unterminated = true;
        var value = "";
        while (i < source.length) {
          var chr = at(source, i);
          if (chr === "\\") {
            var twoChars = slice(source, i, i + 2);
            if (hasOwn(codePoints, twoChars)) {
              value += codePoints[twoChars];
              i += 2;
            } else if (twoChars === "\\u") {
              i += 2;
              var fourHexDigits = slice(source, i, i + 4);
              if (!exec(IS_4_HEX_DIGITS, fourHexDigits)) throw new $SyntaxError("Bad Unicode escape at: " + i);
              value += fromCharCode($parseInt(fourHexDigits, 16));
              i += 4;
            } else throw new $SyntaxError('Unknown escape sequence: "' + twoChars + '"');
          } else if (chr === '"') {
            unterminated = false;
            i++;
            break;
          } else {
            if (exec(IS_C0_CONTROL_CODE, chr)) throw new $SyntaxError("Bad control character in string literal at: " + i);
            value += chr;
            i++;
          }
        }
        if (unterminated) throw new $SyntaxError("Unterminated string at: " + i);
        return { value, end: i };
      };
    })
  ),
  /***/
  1103: (
    /***/
    ((module) => {
      module.exports = function(exec) {
        try {
          return { error: false, value: exec() };
        } catch (error) {
          return { error: true, value: error };
        }
      };
    })
  ),
  /***/
  7750: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var isNullOrUndefined = __webpack_require__2(4117);
      var $TypeError = TypeError;
      module.exports = function(it) {
        if (isNullOrUndefined(it)) throw new $TypeError("Can't call method on " + it);
        return it;
      };
    })
  ),
  /***/
  9286: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var SetHelpers = __webpack_require__2(4402);
      var iterate = __webpack_require__2(8469);
      var Set2 = SetHelpers.Set;
      var add = SetHelpers.add;
      module.exports = function(set) {
        var result = new Set2();
        iterate(set, function(it) {
          add(result, it);
        });
        return result;
      };
    })
  ),
  /***/
  3440: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aSet = __webpack_require__2(7080);
      var SetHelpers = __webpack_require__2(4402);
      var clone = __webpack_require__2(9286);
      var size = __webpack_require__2(5170);
      var getSetRecord = __webpack_require__2(3789);
      var iterateSet = __webpack_require__2(8469);
      var iterateSimple = __webpack_require__2(507);
      var has = SetHelpers.has;
      var remove = SetHelpers.remove;
      module.exports = function difference(other) {
        var O = aSet(this);
        var otherRec = getSetRecord(other);
        var result = clone(O);
        if (size(O) <= otherRec.size) iterateSet(O, function(e) {
          if (otherRec.includes(e)) remove(result, e);
        });
        else iterateSimple(otherRec.getIterator(), function(e) {
          if (has(O, e)) remove(result, e);
        });
        return result;
      };
    })
  ),
  /***/
  4402: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var SetPrototype = Set.prototype;
      module.exports = {
        // eslint-disable-next-line es/no-set -- safe
        Set,
        add: uncurryThis(SetPrototype.add),
        has: uncurryThis(SetPrototype.has),
        remove: uncurryThis(SetPrototype["delete"]),
        proto: SetPrototype
      };
    })
  ),
  /***/
  8750: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aSet = __webpack_require__2(7080);
      var SetHelpers = __webpack_require__2(4402);
      var size = __webpack_require__2(5170);
      var getSetRecord = __webpack_require__2(3789);
      var iterateSet = __webpack_require__2(8469);
      var iterateSimple = __webpack_require__2(507);
      var Set2 = SetHelpers.Set;
      var add = SetHelpers.add;
      var has = SetHelpers.has;
      module.exports = function intersection(other) {
        var O = aSet(this);
        var otherRec = getSetRecord(other);
        var result = new Set2();
        if (size(O) > otherRec.size) {
          iterateSimple(otherRec.getIterator(), function(e) {
            if (has(O, e)) add(result, e);
          });
        } else {
          iterateSet(O, function(e) {
            if (otherRec.includes(e)) add(result, e);
          });
        }
        return result;
      };
    })
  ),
  /***/
  4449: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aSet = __webpack_require__2(7080);
      var has = __webpack_require__2(4402).has;
      var size = __webpack_require__2(5170);
      var getSetRecord = __webpack_require__2(3789);
      var iterateSet = __webpack_require__2(8469);
      var iterateSimple = __webpack_require__2(507);
      var iteratorClose = __webpack_require__2(9539);
      module.exports = function isDisjointFrom(other) {
        var O = aSet(this);
        var otherRec = getSetRecord(other);
        if (size(O) <= otherRec.size) return iterateSet(O, function(e) {
          if (otherRec.includes(e)) return false;
        }, true) !== false;
        var iterator = otherRec.getIterator();
        return iterateSimple(iterator, function(e) {
          if (has(O, e)) return iteratorClose(iterator, "normal", false);
        }) !== false;
      };
    })
  ),
  /***/
  3838: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aSet = __webpack_require__2(7080);
      var size = __webpack_require__2(5170);
      var iterate = __webpack_require__2(8469);
      var getSetRecord = __webpack_require__2(3789);
      module.exports = function isSubsetOf(other) {
        var O = aSet(this);
        var otherRec = getSetRecord(other);
        if (size(O) > otherRec.size) return false;
        return iterate(O, function(e) {
          if (!otherRec.includes(e)) return false;
        }, true) !== false;
      };
    })
  ),
  /***/
  8527: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aSet = __webpack_require__2(7080);
      var has = __webpack_require__2(4402).has;
      var size = __webpack_require__2(5170);
      var getSetRecord = __webpack_require__2(3789);
      var iterateSimple = __webpack_require__2(507);
      var iteratorClose = __webpack_require__2(9539);
      module.exports = function isSupersetOf(other) {
        var O = aSet(this);
        var otherRec = getSetRecord(other);
        if (size(O) < otherRec.size) return false;
        var iterator = otherRec.getIterator();
        return iterateSimple(iterator, function(e) {
          if (!has(O, e)) return iteratorClose(iterator, "normal", false);
        }) !== false;
      };
    })
  ),
  /***/
  8469: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var iterateSimple = __webpack_require__2(507);
      var SetHelpers = __webpack_require__2(4402);
      var Set2 = SetHelpers.Set;
      var SetPrototype = SetHelpers.proto;
      var forEach = uncurryThis(SetPrototype.forEach);
      var keys = uncurryThis(SetPrototype.keys);
      var next = keys(new Set2()).next;
      module.exports = function(set, fn, interruptible) {
        return interruptible ? iterateSimple({ iterator: keys(set), next }, fn) : forEach(set, fn);
      };
    })
  ),
  /***/
  4916: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var getBuiltIn = __webpack_require__2(7751);
      var createSetLike = function(size) {
        return {
          size,
          has: function() {
            return false;
          },
          keys: function() {
            return {
              next: function() {
                return { done: true };
              }
            };
          }
        };
      };
      module.exports = function(name) {
        var Set2 = getBuiltIn("Set");
        try {
          new Set2()[name](createSetLike(0));
          try {
            new Set2()[name](createSetLike(-1));
            return false;
          } catch (error2) {
            return true;
          }
        } catch (error) {
          return false;
        }
      };
    })
  ),
  /***/
  5170: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThisAccessor = __webpack_require__2(6706);
      var SetHelpers = __webpack_require__2(4402);
      module.exports = uncurryThisAccessor(SetHelpers.proto, "size", "get") || function(set) {
        return set.size;
      };
    })
  ),
  /***/
  3650: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aSet = __webpack_require__2(7080);
      var SetHelpers = __webpack_require__2(4402);
      var clone = __webpack_require__2(9286);
      var getSetRecord = __webpack_require__2(3789);
      var iterateSimple = __webpack_require__2(507);
      var add = SetHelpers.add;
      var has = SetHelpers.has;
      var remove = SetHelpers.remove;
      module.exports = function symmetricDifference(other) {
        var O = aSet(this);
        var keysIter = getSetRecord(other).getIterator();
        var result = clone(O);
        iterateSimple(keysIter, function(e) {
          if (has(O, e)) remove(result, e);
          else add(result, e);
        });
        return result;
      };
    })
  ),
  /***/
  4204: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var aSet = __webpack_require__2(7080);
      var add = __webpack_require__2(4402).add;
      var clone = __webpack_require__2(9286);
      var getSetRecord = __webpack_require__2(3789);
      var iterateSimple = __webpack_require__2(507);
      module.exports = function union(other) {
        var O = aSet(this);
        var keysIter = getSetRecord(other).getIterator();
        var result = clone(O);
        iterateSimple(keysIter, function(it) {
          add(result, it);
        });
        return result;
      };
    })
  ),
  /***/
  6119: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var shared = __webpack_require__2(5745);
      var uid = __webpack_require__2(3392);
      var keys = shared("keys");
      module.exports = function(key) {
        return keys[key] || (keys[key] = uid(key));
      };
    })
  ),
  /***/
  7629: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var IS_PURE = __webpack_require__2(6395);
      var globalThis2 = __webpack_require__2(4576);
      var defineGlobalProperty = __webpack_require__2(9433);
      var SHARED = "__core-js_shared__";
      var store = module.exports = globalThis2[SHARED] || defineGlobalProperty(SHARED, {});
      (store.versions || (store.versions = [])).push({
        version: "3.39.0",
        mode: IS_PURE ? "pure" : "global",
        copyright: "\xA9 2014-2024 Denis Pushkarev (zloirock.ru)",
        license: "https://github.com/zloirock/core-js/blob/v3.39.0/LICENSE",
        source: "https://github.com/zloirock/core-js"
      });
    })
  ),
  /***/
  5745: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var store = __webpack_require__2(7629);
      module.exports = function(key, value) {
        return store[key] || (store[key] = value || {});
      };
    })
  ),
  /***/
  1548: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var fails = __webpack_require__2(9039);
      var V8 = __webpack_require__2(9519);
      var ENVIRONMENT = __webpack_require__2(4215);
      var structuredClone2 = globalThis2.structuredClone;
      module.exports = !!structuredClone2 && !fails(function() {
        if (ENVIRONMENT === "DENO" && V8 > 92 || ENVIRONMENT === "NODE" && V8 > 94 || ENVIRONMENT === "BROWSER" && V8 > 97) return false;
        var buffer = new ArrayBuffer(8);
        var clone = structuredClone2(buffer, { transfer: [buffer] });
        return buffer.byteLength !== 0 || clone.byteLength !== 8;
      });
    })
  ),
  /***/
  4495: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var V8_VERSION = __webpack_require__2(9519);
      var fails = __webpack_require__2(9039);
      var globalThis2 = __webpack_require__2(4576);
      var $String = globalThis2.String;
      module.exports = !!Object.getOwnPropertySymbols && !fails(function() {
        var symbol = /* @__PURE__ */ Symbol("symbol detection");
        return !$String(symbol) || !(Object(symbol) instanceof Symbol) || // Chrome 38-40 symbols are not inherited from DOM collections prototypes to instances
        !Symbol.sham && V8_VERSION && V8_VERSION < 41;
      });
    })
  ),
  /***/
  5610: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var toIntegerOrInfinity = __webpack_require__2(1291);
      var max = Math.max;
      var min = Math.min;
      module.exports = function(index, length) {
        var integer = toIntegerOrInfinity(index);
        return integer < 0 ? max(integer + length, 0) : min(integer, length);
      };
    })
  ),
  /***/
  5854: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var toPrimitive = __webpack_require__2(2777);
      var $TypeError = TypeError;
      module.exports = function(argument) {
        var prim = toPrimitive(argument, "number");
        if (typeof prim == "number") throw new $TypeError("Can't convert number to bigint");
        return BigInt(prim);
      };
    })
  ),
  /***/
  7696: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var toIntegerOrInfinity = __webpack_require__2(1291);
      var toLength = __webpack_require__2(8014);
      var $RangeError = RangeError;
      module.exports = function(it) {
        if (it === void 0) return 0;
        var number = toIntegerOrInfinity(it);
        var length = toLength(number);
        if (number !== length) throw new $RangeError("Wrong length or index");
        return length;
      };
    })
  ),
  /***/
  5397: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var IndexedObject = __webpack_require__2(7055);
      var requireObjectCoercible = __webpack_require__2(7750);
      module.exports = function(it) {
        return IndexedObject(requireObjectCoercible(it));
      };
    })
  ),
  /***/
  1291: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var trunc = __webpack_require__2(741);
      module.exports = function(argument) {
        var number = +argument;
        return number !== number || number === 0 ? 0 : trunc(number);
      };
    })
  ),
  /***/
  8014: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var toIntegerOrInfinity = __webpack_require__2(1291);
      var min = Math.min;
      module.exports = function(argument) {
        var len = toIntegerOrInfinity(argument);
        return len > 0 ? min(len, 9007199254740991) : 0;
      };
    })
  ),
  /***/
  8981: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var requireObjectCoercible = __webpack_require__2(7750);
      var $Object = Object;
      module.exports = function(argument) {
        return $Object(requireObjectCoercible(argument));
      };
    })
  ),
  /***/
  9590: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var toIntegerOrInfinity = __webpack_require__2(1291);
      var $RangeError = RangeError;
      module.exports = function(it) {
        var result = toIntegerOrInfinity(it);
        if (result < 0) throw new $RangeError("The argument can't be less than 0");
        return result;
      };
    })
  ),
  /***/
  2777: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var call = __webpack_require__2(9565);
      var isObject = __webpack_require__2(34);
      var isSymbol = __webpack_require__2(757);
      var getMethod = __webpack_require__2(5966);
      var ordinaryToPrimitive = __webpack_require__2(4270);
      var wellKnownSymbol = __webpack_require__2(8227);
      var $TypeError = TypeError;
      var TO_PRIMITIVE = wellKnownSymbol("toPrimitive");
      module.exports = function(input, pref) {
        if (!isObject(input) || isSymbol(input)) return input;
        var exoticToPrim = getMethod(input, TO_PRIMITIVE);
        var result;
        if (exoticToPrim) {
          if (pref === void 0) pref = "default";
          result = call(exoticToPrim, input, pref);
          if (!isObject(result) || isSymbol(result)) return result;
          throw new $TypeError("Can't convert object to primitive value");
        }
        if (pref === void 0) pref = "number";
        return ordinaryToPrimitive(input, pref);
      };
    })
  ),
  /***/
  6969: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var toPrimitive = __webpack_require__2(2777);
      var isSymbol = __webpack_require__2(757);
      module.exports = function(argument) {
        var key = toPrimitive(argument, "string");
        return isSymbol(key) ? key : key + "";
      };
    })
  ),
  /***/
  2140: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var wellKnownSymbol = __webpack_require__2(8227);
      var TO_STRING_TAG = wellKnownSymbol("toStringTag");
      var test = {};
      test[TO_STRING_TAG] = "z";
      module.exports = String(test) === "[object z]";
    })
  ),
  /***/
  655: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var classof = __webpack_require__2(6955);
      var $String = String;
      module.exports = function(argument) {
        if (classof(argument) === "Symbol") throw new TypeError("Cannot convert a Symbol value to a string");
        return $String(argument);
      };
    })
  ),
  /***/
  6823: (
    /***/
    ((module) => {
      var $String = String;
      module.exports = function(argument) {
        try {
          return $String(argument);
        } catch (error) {
          return "Object";
        }
      };
    })
  ),
  /***/
  3392: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var uncurryThis = __webpack_require__2(9504);
      var id = 0;
      var postfix = Math.random();
      var toString = uncurryThis(1 .toString);
      module.exports = function(key) {
        return "Symbol(" + (key === void 0 ? "" : key) + ")_" + toString(++id + postfix, 36);
      };
    })
  ),
  /***/
  7040: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var NATIVE_SYMBOL = __webpack_require__2(4495);
      module.exports = NATIVE_SYMBOL && !Symbol.sham && typeof Symbol.iterator == "symbol";
    })
  ),
  /***/
  8686: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var fails = __webpack_require__2(9039);
      module.exports = DESCRIPTORS && fails(function() {
        return Object.defineProperty(function() {
        }, "prototype", {
          value: 42,
          writable: false
        }).prototype !== 42;
      });
    })
  ),
  /***/
  2812: (
    /***/
    ((module) => {
      var $TypeError = TypeError;
      module.exports = function(passed, required) {
        if (passed < required) throw new $TypeError("Not enough arguments");
        return passed;
      };
    })
  ),
  /***/
  8622: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var isCallable = __webpack_require__2(4901);
      var WeakMap2 = globalThis2.WeakMap;
      module.exports = isCallable(WeakMap2) && /native code/.test(String(WeakMap2));
    })
  ),
  /***/
  8227: (
    /***/
    ((module, __unused_webpack_exports, __webpack_require__2) => {
      var globalThis2 = __webpack_require__2(4576);
      var shared = __webpack_require__2(5745);
      var hasOwn = __webpack_require__2(9297);
      var uid = __webpack_require__2(3392);
      var NATIVE_SYMBOL = __webpack_require__2(4495);
      var USE_SYMBOL_AS_UID = __webpack_require__2(7040);
      var Symbol2 = globalThis2.Symbol;
      var WellKnownSymbolsStore = shared("wks");
      var createWellKnownSymbol = USE_SYMBOL_AS_UID ? Symbol2["for"] || Symbol2 : Symbol2 && Symbol2.withoutSetter || uid;
      module.exports = function(name) {
        if (!hasOwn(WellKnownSymbolsStore, name)) {
          WellKnownSymbolsStore[name] = NATIVE_SYMBOL && hasOwn(Symbol2, name) ? Symbol2[name] : createWellKnownSymbol("Symbol." + name);
        }
        return WellKnownSymbolsStore[name];
      };
    })
  ),
  /***/
  6573: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var defineBuiltInAccessor = __webpack_require__2(2106);
      var isDetached = __webpack_require__2(3238);
      var ArrayBufferPrototype = ArrayBuffer.prototype;
      if (DESCRIPTORS && !("detached" in ArrayBufferPrototype)) {
        defineBuiltInAccessor(ArrayBufferPrototype, "detached", {
          configurable: true,
          get: function detached() {
            return isDetached(this);
          }
        });
      }
    })
  ),
  /***/
  7936: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var $transfer = __webpack_require__2(5636);
      if ($transfer) $({ target: "ArrayBuffer", proto: true }, {
        transferToFixedLength: function transferToFixedLength() {
          return $transfer(this, arguments.length ? arguments[0] : void 0, false);
        }
      });
    })
  ),
  /***/
  8100: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var $transfer = __webpack_require__2(5636);
      if ($transfer) $({ target: "ArrayBuffer", proto: true }, {
        transfer: function transfer() {
          return $transfer(this, arguments.length ? arguments[0] : void 0, true);
        }
      });
    })
  ),
  /***/
  4114: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var toObject = __webpack_require__2(8981);
      var lengthOfArrayLike = __webpack_require__2(6198);
      var setArrayLength = __webpack_require__2(4527);
      var doesNotExceedSafeInteger = __webpack_require__2(6837);
      var fails = __webpack_require__2(9039);
      var INCORRECT_TO_LENGTH = fails(function() {
        return [].push.call({ length: 4294967296 }, 1) !== 4294967297;
      });
      var properErrorOnNonWritableLength = function() {
        try {
          Object.defineProperty([], "length", { writable: false }).push();
        } catch (error) {
          return error instanceof TypeError;
        }
      };
      var FORCED = INCORRECT_TO_LENGTH || !properErrorOnNonWritableLength();
      $({ target: "Array", proto: true, arity: 1, forced: FORCED }, {
        // eslint-disable-next-line no-unused-vars -- required for `.length`
        push: function push(item) {
          var O = toObject(this);
          var len = lengthOfArrayLike(O);
          var argCount = arguments.length;
          doesNotExceedSafeInteger(len + argCount);
          for (var i = 0; i < argCount; i++) {
            O[len] = arguments[i];
            len++;
          }
          setArrayLength(O, len);
          return len;
        }
      });
    })
  ),
  /***/
  8111: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var globalThis2 = __webpack_require__2(4576);
      var anInstance = __webpack_require__2(679);
      var anObject = __webpack_require__2(8551);
      var isCallable = __webpack_require__2(4901);
      var getPrototypeOf = __webpack_require__2(2787);
      var defineBuiltInAccessor = __webpack_require__2(2106);
      var createProperty = __webpack_require__2(4659);
      var fails = __webpack_require__2(9039);
      var hasOwn = __webpack_require__2(9297);
      var wellKnownSymbol = __webpack_require__2(8227);
      var IteratorPrototype = __webpack_require__2(7657).IteratorPrototype;
      var DESCRIPTORS = __webpack_require__2(3724);
      var IS_PURE = __webpack_require__2(6395);
      var CONSTRUCTOR = "constructor";
      var ITERATOR = "Iterator";
      var TO_STRING_TAG = wellKnownSymbol("toStringTag");
      var $TypeError = TypeError;
      var NativeIterator = globalThis2[ITERATOR];
      var FORCED = IS_PURE || !isCallable(NativeIterator) || NativeIterator.prototype !== IteratorPrototype || !fails(function() {
        NativeIterator({});
      });
      var IteratorConstructor = function Iterator() {
        anInstance(this, IteratorPrototype);
        if (getPrototypeOf(this) === IteratorPrototype) throw new $TypeError("Abstract class Iterator not directly constructable");
      };
      var defineIteratorPrototypeAccessor = function(key, value) {
        if (DESCRIPTORS) {
          defineBuiltInAccessor(IteratorPrototype, key, {
            configurable: true,
            get: function() {
              return value;
            },
            set: function(replacement) {
              anObject(this);
              if (this === IteratorPrototype) throw new $TypeError("You can't redefine this property");
              if (hasOwn(this, key)) this[key] = replacement;
              else createProperty(this, key, replacement);
            }
          });
        } else IteratorPrototype[key] = value;
      };
      if (!hasOwn(IteratorPrototype, TO_STRING_TAG)) defineIteratorPrototypeAccessor(TO_STRING_TAG, ITERATOR);
      if (FORCED || !hasOwn(IteratorPrototype, CONSTRUCTOR) || IteratorPrototype[CONSTRUCTOR] === Object) {
        defineIteratorPrototypeAccessor(CONSTRUCTOR, IteratorConstructor);
      }
      IteratorConstructor.prototype = IteratorPrototype;
      $({ global: true, constructor: true, forced: FORCED }, {
        Iterator: IteratorConstructor
      });
    })
  ),
  /***/
  9314: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var call = __webpack_require__2(9565);
      var anObject = __webpack_require__2(8551);
      var getIteratorDirect = __webpack_require__2(1767);
      var notANaN = __webpack_require__2(4149);
      var toPositiveInteger = __webpack_require__2(9590);
      var createIteratorProxy = __webpack_require__2(9462);
      var IS_PURE = __webpack_require__2(6395);
      var IteratorProxy = createIteratorProxy(function() {
        var iterator = this.iterator;
        var next = this.next;
        var result, done;
        while (this.remaining) {
          this.remaining--;
          result = anObject(call(next, iterator));
          done = this.done = !!result.done;
          if (done) return;
        }
        result = anObject(call(next, iterator));
        done = this.done = !!result.done;
        if (!done) return result.value;
      });
      $({ target: "Iterator", proto: true, real: true, forced: IS_PURE }, {
        drop: function drop(limit) {
          anObject(this);
          var remaining = toPositiveInteger(notANaN(+limit));
          return new IteratorProxy(getIteratorDirect(this), {
            remaining
          });
        }
      });
    })
  ),
  /***/
  1148: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var iterate = __webpack_require__2(2652);
      var aCallable = __webpack_require__2(9306);
      var anObject = __webpack_require__2(8551);
      var getIteratorDirect = __webpack_require__2(1767);
      $({ target: "Iterator", proto: true, real: true }, {
        every: function every(predicate) {
          anObject(this);
          aCallable(predicate);
          var record = getIteratorDirect(this);
          var counter = 0;
          return !iterate(record, function(value, stop) {
            if (!predicate(value, counter++)) return stop();
          }, { IS_RECORD: true, INTERRUPTED: true }).stopped;
        }
      });
    })
  ),
  /***/
  2489: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var call = __webpack_require__2(9565);
      var aCallable = __webpack_require__2(9306);
      var anObject = __webpack_require__2(8551);
      var getIteratorDirect = __webpack_require__2(1767);
      var createIteratorProxy = __webpack_require__2(9462);
      var callWithSafeIterationClosing = __webpack_require__2(6319);
      var IS_PURE = __webpack_require__2(6395);
      var IteratorProxy = createIteratorProxy(function() {
        var iterator = this.iterator;
        var predicate = this.predicate;
        var next = this.next;
        var result, done, value;
        while (true) {
          result = anObject(call(next, iterator));
          done = this.done = !!result.done;
          if (done) return;
          value = result.value;
          if (callWithSafeIterationClosing(iterator, predicate, [value, this.counter++], true)) return value;
        }
      });
      $({ target: "Iterator", proto: true, real: true, forced: IS_PURE }, {
        filter: function filter(predicate) {
          anObject(this);
          aCallable(predicate);
          return new IteratorProxy(getIteratorDirect(this), {
            predicate
          });
        }
      });
    })
  ),
  /***/
  531: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var call = __webpack_require__2(9565);
      var aCallable = __webpack_require__2(9306);
      var anObject = __webpack_require__2(8551);
      var getIteratorDirect = __webpack_require__2(1767);
      var getIteratorFlattenable = __webpack_require__2(8646);
      var createIteratorProxy = __webpack_require__2(9462);
      var iteratorClose = __webpack_require__2(9539);
      var IS_PURE = __webpack_require__2(6395);
      var IteratorProxy = createIteratorProxy(function() {
        var iterator = this.iterator;
        var mapper = this.mapper;
        var result, inner;
        while (true) {
          if (inner = this.inner) try {
            result = anObject(call(inner.next, inner.iterator));
            if (!result.done) return result.value;
            this.inner = null;
          } catch (error) {
            iteratorClose(iterator, "throw", error);
          }
          result = anObject(call(this.next, iterator));
          if (this.done = !!result.done) return;
          try {
            this.inner = getIteratorFlattenable(mapper(result.value, this.counter++), false);
          } catch (error) {
            iteratorClose(iterator, "throw", error);
          }
        }
      });
      $({ target: "Iterator", proto: true, real: true, forced: IS_PURE }, {
        flatMap: function flatMap(mapper) {
          anObject(this);
          aCallable(mapper);
          return new IteratorProxy(getIteratorDirect(this), {
            mapper,
            inner: null
          });
        }
      });
    })
  ),
  /***/
  1701: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var map = __webpack_require__2(713);
      var IS_PURE = __webpack_require__2(6395);
      $({ target: "Iterator", proto: true, real: true, forced: IS_PURE }, {
        map
      });
    })
  ),
  /***/
  3579: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var iterate = __webpack_require__2(2652);
      var aCallable = __webpack_require__2(9306);
      var anObject = __webpack_require__2(8551);
      var getIteratorDirect = __webpack_require__2(1767);
      $({ target: "Iterator", proto: true, real: true }, {
        some: function some(predicate) {
          anObject(this);
          aCallable(predicate);
          var record = getIteratorDirect(this);
          var counter = 0;
          return iterate(record, function(value, stop) {
            if (predicate(value, counter++)) return stop();
          }, { IS_RECORD: true, INTERRUPTED: true }).stopped;
        }
      });
    })
  ),
  /***/
  1689: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var globalThis2 = __webpack_require__2(4576);
      var apply = __webpack_require__2(8745);
      var slice = __webpack_require__2(7680);
      var newPromiseCapabilityModule = __webpack_require__2(6043);
      var aCallable = __webpack_require__2(9306);
      var perform = __webpack_require__2(1103);
      var Promise2 = globalThis2.Promise;
      var ACCEPT_ARGUMENTS = false;
      var FORCED = !Promise2 || !Promise2["try"] || perform(function() {
        Promise2["try"](function(argument) {
          ACCEPT_ARGUMENTS = argument === 8;
        }, 8);
      }).error || !ACCEPT_ARGUMENTS;
      $({ target: "Promise", stat: true, forced: FORCED }, {
        "try": function(callbackfn) {
          var args = arguments.length > 1 ? slice(arguments, 1) : [];
          var promiseCapability = newPromiseCapabilityModule.f(this);
          var result = perform(function() {
            return apply(aCallable(callbackfn), void 0, args);
          });
          (result.error ? promiseCapability.reject : promiseCapability.resolve)(result.value);
          return promiseCapability.promise;
        }
      });
    })
  ),
  /***/
  4628: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var newPromiseCapabilityModule = __webpack_require__2(6043);
      $({ target: "Promise", stat: true }, {
        withResolvers: function withResolvers() {
          var promiseCapability = newPromiseCapabilityModule.f(this);
          return {
            promise: promiseCapability.promise,
            resolve: promiseCapability.resolve,
            reject: promiseCapability.reject
          };
        }
      });
    })
  ),
  /***/
  7642: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var difference = __webpack_require__2(3440);
      var setMethodAcceptSetLike = __webpack_require__2(4916);
      $({ target: "Set", proto: true, real: true, forced: !setMethodAcceptSetLike("difference") }, {
        difference
      });
    })
  ),
  /***/
  8004: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var fails = __webpack_require__2(9039);
      var intersection = __webpack_require__2(8750);
      var setMethodAcceptSetLike = __webpack_require__2(4916);
      var INCORRECT = !setMethodAcceptSetLike("intersection") || fails(function() {
        return String(Array.from((/* @__PURE__ */ new Set([1, 2, 3])).intersection(/* @__PURE__ */ new Set([3, 2])))) !== "3,2";
      });
      $({ target: "Set", proto: true, real: true, forced: INCORRECT }, {
        intersection
      });
    })
  ),
  /***/
  3853: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var isDisjointFrom = __webpack_require__2(4449);
      var setMethodAcceptSetLike = __webpack_require__2(4916);
      $({ target: "Set", proto: true, real: true, forced: !setMethodAcceptSetLike("isDisjointFrom") }, {
        isDisjointFrom
      });
    })
  ),
  /***/
  5876: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var isSubsetOf = __webpack_require__2(3838);
      var setMethodAcceptSetLike = __webpack_require__2(4916);
      $({ target: "Set", proto: true, real: true, forced: !setMethodAcceptSetLike("isSubsetOf") }, {
        isSubsetOf
      });
    })
  ),
  /***/
  2475: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var isSupersetOf = __webpack_require__2(8527);
      var setMethodAcceptSetLike = __webpack_require__2(4916);
      $({ target: "Set", proto: true, real: true, forced: !setMethodAcceptSetLike("isSupersetOf") }, {
        isSupersetOf
      });
    })
  ),
  /***/
  5024: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var symmetricDifference = __webpack_require__2(3650);
      var setMethodAcceptSetLike = __webpack_require__2(4916);
      $({ target: "Set", proto: true, real: true, forced: !setMethodAcceptSetLike("symmetricDifference") }, {
        symmetricDifference
      });
    })
  ),
  /***/
  1698: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var union = __webpack_require__2(4204);
      var setMethodAcceptSetLike = __webpack_require__2(4916);
      $({ target: "Set", proto: true, real: true, forced: !setMethodAcceptSetLike("union") }, {
        union
      });
    })
  ),
  /***/
  7467: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var arrayToReversed = __webpack_require__2(7628);
      var ArrayBufferViewCore = __webpack_require__2(4644);
      var aTypedArray = ArrayBufferViewCore.aTypedArray;
      var exportTypedArrayMethod = ArrayBufferViewCore.exportTypedArrayMethod;
      var getTypedArrayConstructor = ArrayBufferViewCore.getTypedArrayConstructor;
      exportTypedArrayMethod("toReversed", function toReversed() {
        return arrayToReversed(aTypedArray(this), getTypedArrayConstructor(this));
      });
    })
  ),
  /***/
  4732: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var ArrayBufferViewCore = __webpack_require__2(4644);
      var uncurryThis = __webpack_require__2(9504);
      var aCallable = __webpack_require__2(9306);
      var arrayFromConstructorAndList = __webpack_require__2(5370);
      var aTypedArray = ArrayBufferViewCore.aTypedArray;
      var getTypedArrayConstructor = ArrayBufferViewCore.getTypedArrayConstructor;
      var exportTypedArrayMethod = ArrayBufferViewCore.exportTypedArrayMethod;
      var sort = uncurryThis(ArrayBufferViewCore.TypedArrayPrototype.sort);
      exportTypedArrayMethod("toSorted", function toSorted(compareFn) {
        if (compareFn !== void 0) aCallable(compareFn);
        var O = aTypedArray(this);
        var A = arrayFromConstructorAndList(getTypedArrayConstructor(O), O);
        return sort(A, compareFn);
      });
    })
  ),
  /***/
  9577: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var arrayWith = __webpack_require__2(9928);
      var ArrayBufferViewCore = __webpack_require__2(4644);
      var isBigIntArray = __webpack_require__2(1108);
      var toIntegerOrInfinity = __webpack_require__2(1291);
      var toBigInt = __webpack_require__2(5854);
      var aTypedArray = ArrayBufferViewCore.aTypedArray;
      var getTypedArrayConstructor = ArrayBufferViewCore.getTypedArrayConstructor;
      var exportTypedArrayMethod = ArrayBufferViewCore.exportTypedArrayMethod;
      var PROPER_ORDER = !!(function() {
        try {
          new Int8Array(1)["with"](2, { valueOf: function() {
            throw 8;
          } });
        } catch (error) {
          return error === 8;
        }
      })();
      exportTypedArrayMethod("with", { "with": function(index, value) {
        var O = aTypedArray(this);
        var relativeIndex = toIntegerOrInfinity(index);
        var actualValue = isBigIntArray(O) ? toBigInt(value) : +value;
        return arrayWith(O, getTypedArrayConstructor(O), relativeIndex, actualValue);
      } }["with"], !PROPER_ORDER);
    })
  ),
  /***/
  8992: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      __webpack_require__2(8111);
    })
  ),
  /***/
  4743: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      __webpack_require__2(9314);
    })
  ),
  /***/
  3215: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      __webpack_require__2(1148);
    })
  ),
  /***/
  4520: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      __webpack_require__2(2489);
    })
  ),
  /***/
  670: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      __webpack_require__2(531);
    })
  ),
  /***/
  1454: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      __webpack_require__2(1701);
    })
  ),
  /***/
  7550: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      __webpack_require__2(3579);
    })
  ),
  /***/
  8335: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var DESCRIPTORS = __webpack_require__2(3724);
      var globalThis2 = __webpack_require__2(4576);
      var getBuiltIn = __webpack_require__2(7751);
      var uncurryThis = __webpack_require__2(9504);
      var call = __webpack_require__2(9565);
      var isCallable = __webpack_require__2(4901);
      var isObject = __webpack_require__2(34);
      var isArray = __webpack_require__2(4376);
      var hasOwn = __webpack_require__2(9297);
      var toString = __webpack_require__2(655);
      var lengthOfArrayLike = __webpack_require__2(6198);
      var createProperty = __webpack_require__2(4659);
      var fails = __webpack_require__2(9039);
      var parseJSONString = __webpack_require__2(8235);
      var NATIVE_SYMBOL = __webpack_require__2(4495);
      var JSON2 = globalThis2.JSON;
      var Number2 = globalThis2.Number;
      var SyntaxError2 = globalThis2.SyntaxError;
      var nativeParse = JSON2 && JSON2.parse;
      var enumerableOwnProperties = getBuiltIn("Object", "keys");
      var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      var at = uncurryThis("".charAt);
      var slice = uncurryThis("".slice);
      var exec = uncurryThis(/./.exec);
      var push = uncurryThis([].push);
      var IS_DIGIT = /^\d$/;
      var IS_NON_ZERO_DIGIT = /^[1-9]$/;
      var IS_NUMBER_START = /^[\d-]$/;
      var IS_WHITESPACE = /^[\t\n\r ]$/;
      var PRIMITIVE = 0;
      var OBJECT = 1;
      var $parse = function(source, reviver) {
        source = toString(source);
        var context = new Context(source, 0, "");
        var root = context.parse();
        var value = root.value;
        var endIndex = context.skip(IS_WHITESPACE, root.end);
        if (endIndex < source.length) {
          throw new SyntaxError2('Unexpected extra character: "' + at(source, endIndex) + '" after the parsed data at: ' + endIndex);
        }
        return isCallable(reviver) ? internalize({ "": value }, "", reviver, root) : value;
      };
      var internalize = function(holder, name, reviver, node) {
        var val = holder[name];
        var unmodified = node && val === node.value;
        var context = unmodified && typeof node.source == "string" ? { source: node.source } : {};
        var elementRecordsLen, keys, len, i, P;
        if (isObject(val)) {
          var nodeIsArray = isArray(val);
          var nodes = unmodified ? node.nodes : nodeIsArray ? [] : {};
          if (nodeIsArray) {
            elementRecordsLen = nodes.length;
            len = lengthOfArrayLike(val);
            for (i = 0; i < len; i++) {
              internalizeProperty(val, i, internalize(val, "" + i, reviver, i < elementRecordsLen ? nodes[i] : void 0));
            }
          } else {
            keys = enumerableOwnProperties(val);
            len = lengthOfArrayLike(keys);
            for (i = 0; i < len; i++) {
              P = keys[i];
              internalizeProperty(val, P, internalize(val, P, reviver, hasOwn(nodes, P) ? nodes[P] : void 0));
            }
          }
        }
        return call(reviver, holder, name, val, context);
      };
      var internalizeProperty = function(object, key, value) {
        if (DESCRIPTORS) {
          var descriptor = getOwnPropertyDescriptor(object, key);
          if (descriptor && !descriptor.configurable) return;
        }
        if (value === void 0) delete object[key];
        else createProperty(object, key, value);
      };
      var Node2 = function(value, end, source, nodes) {
        this.value = value;
        this.end = end;
        this.source = source;
        this.nodes = nodes;
      };
      var Context = function(source, index) {
        this.source = source;
        this.index = index;
      };
      Context.prototype = {
        fork: function(nextIndex) {
          return new Context(this.source, nextIndex);
        },
        parse: function() {
          var source = this.source;
          var i = this.skip(IS_WHITESPACE, this.index);
          var fork = this.fork(i);
          var chr = at(source, i);
          if (exec(IS_NUMBER_START, chr)) return fork.number();
          switch (chr) {
            case "{":
              return fork.object();
            case "[":
              return fork.array();
            case '"':
              return fork.string();
            case "t":
              return fork.keyword(true);
            case "f":
              return fork.keyword(false);
            case "n":
              return fork.keyword(null);
          }
          throw new SyntaxError2('Unexpected character: "' + chr + '" at: ' + i);
        },
        node: function(type, value, start, end, nodes) {
          return new Node2(value, end, type ? null : slice(this.source, start, end), nodes);
        },
        object: function() {
          var source = this.source;
          var i = this.index + 1;
          var expectKeypair = false;
          var object = {};
          var nodes = {};
          while (i < source.length) {
            i = this.until(['"', "}"], i);
            if (at(source, i) === "}" && !expectKeypair) {
              i++;
              break;
            }
            var result = this.fork(i).string();
            var key = result.value;
            i = result.end;
            i = this.until([":"], i) + 1;
            i = this.skip(IS_WHITESPACE, i);
            result = this.fork(i).parse();
            createProperty(nodes, key, result);
            createProperty(object, key, result.value);
            i = this.until([",", "}"], result.end);
            var chr = at(source, i);
            if (chr === ",") {
              expectKeypair = true;
              i++;
            } else if (chr === "}") {
              i++;
              break;
            }
          }
          return this.node(OBJECT, object, this.index, i, nodes);
        },
        array: function() {
          var source = this.source;
          var i = this.index + 1;
          var expectElement = false;
          var array = [];
          var nodes = [];
          while (i < source.length) {
            i = this.skip(IS_WHITESPACE, i);
            if (at(source, i) === "]" && !expectElement) {
              i++;
              break;
            }
            var result = this.fork(i).parse();
            push(nodes, result);
            push(array, result.value);
            i = this.until([",", "]"], result.end);
            if (at(source, i) === ",") {
              expectElement = true;
              i++;
            } else if (at(source, i) === "]") {
              i++;
              break;
            }
          }
          return this.node(OBJECT, array, this.index, i, nodes);
        },
        string: function() {
          var index = this.index;
          var parsed = parseJSONString(this.source, this.index + 1);
          return this.node(PRIMITIVE, parsed.value, index, parsed.end);
        },
        number: function() {
          var source = this.source;
          var startIndex = this.index;
          var i = startIndex;
          if (at(source, i) === "-") i++;
          if (at(source, i) === "0") i++;
          else if (exec(IS_NON_ZERO_DIGIT, at(source, i))) i = this.skip(IS_DIGIT, i + 1);
          else throw new SyntaxError2("Failed to parse number at: " + i);
          if (at(source, i) === ".") i = this.skip(IS_DIGIT, i + 1);
          if (at(source, i) === "e" || at(source, i) === "E") {
            i++;
            if (at(source, i) === "+" || at(source, i) === "-") i++;
            var exponentStartIndex = i;
            i = this.skip(IS_DIGIT, i);
            if (exponentStartIndex === i) throw new SyntaxError2("Failed to parse number's exponent value at: " + i);
          }
          return this.node(PRIMITIVE, Number2(slice(source, startIndex, i)), startIndex, i);
        },
        keyword: function(value) {
          var keyword = "" + value;
          var index = this.index;
          var endIndex = index + keyword.length;
          if (slice(this.source, index, endIndex) !== keyword) throw new SyntaxError2("Failed to parse value at: " + index);
          return this.node(PRIMITIVE, value, index, endIndex);
        },
        skip: function(regex, i) {
          var source = this.source;
          for (; i < source.length; i++) if (!exec(regex, at(source, i))) break;
          return i;
        },
        until: function(array, i) {
          i = this.skip(IS_WHITESPACE, i);
          var chr = at(this.source, i);
          for (var j = 0; j < array.length; j++) if (array[j] === chr) return i;
          throw new SyntaxError2('Unexpected character: "' + chr + '" at: ' + i);
        }
      };
      var NO_SOURCE_SUPPORT = fails(function() {
        var unsafeInt = "9007199254740993";
        var source;
        nativeParse(unsafeInt, function(key, value, context) {
          source = context.source;
        });
        return source !== unsafeInt;
      });
      var PROPER_BASE_PARSE = NATIVE_SYMBOL && !fails(function() {
        return 1 / nativeParse("-0 	") !== -Infinity;
      });
      $({ target: "JSON", stat: true, forced: NO_SOURCE_SUPPORT }, {
        parse: function parse(text, reviver) {
          return PROPER_BASE_PARSE && !isCallable(reviver) ? nativeParse(text) : $parse(text, reviver);
        }
      });
    })
  ),
  /***/
  5247: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      __webpack_require__2(1689);
    })
  ),
  /***/
  4979: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var $ = __webpack_require__2(6518);
      var globalThis2 = __webpack_require__2(4576);
      var getBuiltIn = __webpack_require__2(7751);
      var createPropertyDescriptor = __webpack_require__2(6980);
      var defineProperty = __webpack_require__2(4913).f;
      var hasOwn = __webpack_require__2(9297);
      var anInstance = __webpack_require__2(679);
      var inheritIfRequired = __webpack_require__2(3167);
      var normalizeStringArgument = __webpack_require__2(2603);
      var DOMExceptionConstants = __webpack_require__2(5002);
      var clearErrorStack = __webpack_require__2(8574);
      var DESCRIPTORS = __webpack_require__2(3724);
      var IS_PURE = __webpack_require__2(6395);
      var DOM_EXCEPTION = "DOMException";
      var Error2 = getBuiltIn("Error");
      var NativeDOMException = getBuiltIn(DOM_EXCEPTION);
      var $DOMException = function DOMException() {
        anInstance(this, DOMExceptionPrototype);
        var argumentsLength = arguments.length;
        var message = normalizeStringArgument(argumentsLength < 1 ? void 0 : arguments[0]);
        var name = normalizeStringArgument(argumentsLength < 2 ? void 0 : arguments[1], "Error");
        var that = new NativeDOMException(message, name);
        var error = new Error2(message);
        error.name = DOM_EXCEPTION;
        defineProperty(that, "stack", createPropertyDescriptor(1, clearErrorStack(error.stack, 1)));
        inheritIfRequired(that, this, $DOMException);
        return that;
      };
      var DOMExceptionPrototype = $DOMException.prototype = NativeDOMException.prototype;
      var ERROR_HAS_STACK = "stack" in new Error2(DOM_EXCEPTION);
      var DOM_EXCEPTION_HAS_STACK = "stack" in new NativeDOMException(1, 2);
      var descriptor = NativeDOMException && DESCRIPTORS && Object.getOwnPropertyDescriptor(globalThis2, DOM_EXCEPTION);
      var BUGGY_DESCRIPTOR = !!descriptor && !(descriptor.writable && descriptor.configurable);
      var FORCED_CONSTRUCTOR = ERROR_HAS_STACK && !BUGGY_DESCRIPTOR && !DOM_EXCEPTION_HAS_STACK;
      $({ global: true, constructor: true, forced: IS_PURE || FORCED_CONSTRUCTOR }, {
        // TODO: fix export logic
        DOMException: FORCED_CONSTRUCTOR ? $DOMException : NativeDOMException
      });
      var PolyfilledDOMException = getBuiltIn(DOM_EXCEPTION);
      var PolyfilledDOMExceptionPrototype = PolyfilledDOMException.prototype;
      if (PolyfilledDOMExceptionPrototype.constructor !== PolyfilledDOMException) {
        if (!IS_PURE) {
          defineProperty(PolyfilledDOMExceptionPrototype, "constructor", createPropertyDescriptor(1, PolyfilledDOMException));
        }
        for (var key in DOMExceptionConstants) if (hasOwn(DOMExceptionConstants, key)) {
          var constant = DOMExceptionConstants[key];
          var constantName = constant.s;
          if (!hasOwn(PolyfilledDOMException, constantName)) {
            defineProperty(PolyfilledDOMException, constantName, createPropertyDescriptor(6, constant.c));
          }
        }
      }
    })
  ),
  /***/
  4603: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var defineBuiltIn = __webpack_require__2(6840);
      var uncurryThis = __webpack_require__2(9504);
      var toString = __webpack_require__2(655);
      var validateArgumentsLength = __webpack_require__2(2812);
      var $URLSearchParams = URLSearchParams;
      var URLSearchParamsPrototype = $URLSearchParams.prototype;
      var append = uncurryThis(URLSearchParamsPrototype.append);
      var $delete = uncurryThis(URLSearchParamsPrototype["delete"]);
      var forEach = uncurryThis(URLSearchParamsPrototype.forEach);
      var push = uncurryThis([].push);
      var params = new $URLSearchParams("a=1&a=2&b=3");
      params["delete"]("a", 1);
      params["delete"]("b", void 0);
      if (params + "" !== "a=2") {
        defineBuiltIn(URLSearchParamsPrototype, "delete", function(name) {
          var length = arguments.length;
          var $value = length < 2 ? void 0 : arguments[1];
          if (length && $value === void 0) return $delete(this, name);
          var entries = [];
          forEach(this, function(v, k) {
            push(entries, { key: k, value: v });
          });
          validateArgumentsLength(length, 1);
          var key = toString(name);
          var value = toString($value);
          var index = 0;
          var dindex = 0;
          var found = false;
          var entriesLength = entries.length;
          var entry;
          while (index < entriesLength) {
            entry = entries[index++];
            if (found || entry.key === key) {
              found = true;
              $delete(this, entry.key);
            } else dindex++;
          }
          while (dindex < entriesLength) {
            entry = entries[dindex++];
            if (!(entry.key === key && entry.value === value)) append(this, entry.key, entry.value);
          }
        }, { enumerable: true, unsafe: true });
      }
    })
  ),
  /***/
  7566: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var defineBuiltIn = __webpack_require__2(6840);
      var uncurryThis = __webpack_require__2(9504);
      var toString = __webpack_require__2(655);
      var validateArgumentsLength = __webpack_require__2(2812);
      var $URLSearchParams = URLSearchParams;
      var URLSearchParamsPrototype = $URLSearchParams.prototype;
      var getAll = uncurryThis(URLSearchParamsPrototype.getAll);
      var $has = uncurryThis(URLSearchParamsPrototype.has);
      var params = new $URLSearchParams("a=1");
      if (params.has("a", 2) || !params.has("a", void 0)) {
        defineBuiltIn(URLSearchParamsPrototype, "has", function has(name) {
          var length = arguments.length;
          var $value = length < 2 ? void 0 : arguments[1];
          if (length && $value === void 0) return $has(this, name);
          var values = getAll(this, name);
          validateArgumentsLength(length, 1);
          var value = toString($value);
          var index = 0;
          while (index < values.length) {
            if (values[index++] === value) return true;
          }
          return false;
        }, { enumerable: true, unsafe: true });
      }
    })
  ),
  /***/
  8721: (
    /***/
    ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__2) => {
      var DESCRIPTORS = __webpack_require__2(3724);
      var uncurryThis = __webpack_require__2(9504);
      var defineBuiltInAccessor = __webpack_require__2(2106);
      var URLSearchParamsPrototype = URLSearchParams.prototype;
      var forEach = uncurryThis(URLSearchParamsPrototype.forEach);
      if (DESCRIPTORS && !("size" in URLSearchParamsPrototype)) {
        defineBuiltInAccessor(URLSearchParamsPrototype, "size", {
          get: function size() {
            var count = 0;
            forEach(this, function() {
              count++;
            });
            return count;
          },
          configurable: true,
          enumerable: true
        });
      }
    })
  )
  /******/
};
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
  var cachedModule = __webpack_module_cache__[moduleId];
  if (cachedModule !== void 0) {
    return cachedModule.exports;
  }
  var module = __webpack_module_cache__[moduleId] = {
    /******/
    // no module.id needed
    /******/
    // no module.loaded needed
    /******/
    exports: {}
    /******/
  };
  __webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
  return module.exports;
}
(() => {
  __webpack_require__.d = (exports, definition) => {
    for (var key in definition) {
      if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
        Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
      }
    }
  };
})();
(() => {
  __webpack_require__.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
})();
var __webpack_exports__ = globalThis.pdfjsLib = {};
__webpack_require__.d(__webpack_exports__, {
  AbortException: () => (
    /* reexport */
    AbortException
  ),
  AnnotationEditorLayer: () => (
    /* reexport */
    AnnotationEditorLayer
  ),
  AnnotationEditorParamsType: () => (
    /* reexport */
    AnnotationEditorParamsType
  ),
  AnnotationEditorType: () => (
    /* reexport */
    AnnotationEditorType
  ),
  AnnotationEditorUIManager: () => (
    /* reexport */
    AnnotationEditorUIManager
  ),
  AnnotationLayer: () => (
    /* reexport */
    AnnotationLayer
  ),
  AnnotationMode: () => (
    /* reexport */
    AnnotationMode
  ),
  ColorPicker: () => (
    /* reexport */
    ColorPicker
  ),
  DOMSVGFactory: () => (
    /* reexport */
    DOMSVGFactory
  ),
  DrawLayer: () => (
    /* reexport */
    DrawLayer
  ),
  FeatureTest: () => (
    /* reexport */
    util_FeatureTest
  ),
  GlobalWorkerOptions: () => (
    /* reexport */
    GlobalWorkerOptions
  ),
  ImageKind: () => (
    /* reexport */
    util_ImageKind
  ),
  InvalidPDFException: () => (
    /* reexport */
    InvalidPDFException
  ),
  MissingPDFException: () => (
    /* reexport */
    MissingPDFException
  ),
  OPS: () => (
    /* reexport */
    OPS
  ),
  OutputScale: () => (
    /* reexport */
    OutputScale
  ),
  PDFDataRangeTransport: () => (
    /* reexport */
    PDFDataRangeTransport
  ),
  PDFDateString: () => (
    /* reexport */
    PDFDateString
  ),
  PDFWorker: () => (
    /* reexport */
    PDFWorker
  ),
  PasswordResponses: () => (
    /* reexport */
    PasswordResponses
  ),
  PermissionFlag: () => (
    /* reexport */
    PermissionFlag
  ),
  PixelsPerInch: () => (
    /* reexport */
    PixelsPerInch
  ),
  RenderingCancelledException: () => (
    /* reexport */
    RenderingCancelledException
  ),
  TextLayer: () => (
    /* reexport */
    TextLayer
  ),
  TouchManager: () => (
    /* reexport */
    TouchManager
  ),
  UnexpectedResponseException: () => (
    /* reexport */
    UnexpectedResponseException
  ),
  Util: () => (
    /* reexport */
    Util
  ),
  VerbosityLevel: () => (
    /* reexport */
    VerbosityLevel
  ),
  XfaLayer: () => (
    /* reexport */
    XfaLayer
  ),
  build: () => (
    /* reexport */
    build
  ),
  createValidAbsoluteUrl: () => (
    /* reexport */
    createValidAbsoluteUrl
  ),
  fetchData: () => (
    /* reexport */
    fetchData
  ),
  getDocument: () => (
    /* reexport */
    getDocument
  ),
  getFilenameFromUrl: () => (
    /* reexport */
    getFilenameFromUrl
  ),
  getPdfFilenameFromUrl: () => (
    /* reexport */
    getPdfFilenameFromUrl
  ),
  getXfaPageViewport: () => (
    /* reexport */
    getXfaPageViewport
  ),
  isDataScheme: () => (
    /* reexport */
    isDataScheme
  ),
  isPdfFile: () => (
    /* reexport */
    isPdfFile
  ),
  noContextMenu: () => (
    /* reexport */
    noContextMenu
  ),
  normalizeUnicode: () => (
    /* reexport */
    normalizeUnicode
  ),
  setLayerDimensions: () => (
    /* reexport */
    setLayerDimensions
  ),
  shadow: () => (
    /* reexport */
    shadow
  ),
  stopEvent: () => (
    /* reexport */
    stopEvent
  ),
  version: () => (
    /* reexport */
    version
  )
});
var es_array_push = __webpack_require__(4114);
var es_array_buffer_detached = __webpack_require__(6573);
var es_array_buffer_transfer = __webpack_require__(8100);
var es_array_buffer_transfer_to_fixed_length = __webpack_require__(7936);
var es_typed_array_to_reversed = __webpack_require__(7467);
var es_typed_array_to_sorted = __webpack_require__(4732);
var es_typed_array_with = __webpack_require__(9577);
var esnext_promise_try = __webpack_require__(5247);
var web_dom_exception_stack = __webpack_require__(4979);
var web_url_search_params_delete = __webpack_require__(4603);
var web_url_search_params_has = __webpack_require__(7566);
var web_url_search_params_size = __webpack_require__(8721);
var isNodeJS = typeof process === "object" && process + "" === "[object process]" && !process.versions.nw && !(process.versions.electron && process.type && process.type !== "browser");
var IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];
var FONT_IDENTITY_MATRIX = [1e-3, 0, 0, 1e-3, 0, 0];
var MAX_IMAGE_SIZE_TO_CACHE = 1e7;
var LINE_FACTOR = 1.35;
var LINE_DESCENT_FACTOR = 0.35;
var BASELINE_FACTOR = LINE_DESCENT_FACTOR / LINE_FACTOR;
var RenderingIntentFlag = {
  ANY: 1,
  DISPLAY: 2,
  PRINT: 4,
  SAVE: 8,
  ANNOTATIONS_FORMS: 16,
  ANNOTATIONS_STORAGE: 32,
  ANNOTATIONS_DISABLE: 64,
  IS_EDITING: 128,
  OPLIST: 256
};
var AnnotationMode = {
  DISABLE: 0,
  ENABLE: 1,
  ENABLE_FORMS: 2,
  ENABLE_STORAGE: 3
};
var AnnotationEditorPrefix = "pdfjs_internal_editor_";
var AnnotationEditorType = {
  DISABLE: -1,
  NONE: 0,
  FREETEXT: 3,
  HIGHLIGHT: 9,
  STAMP: 13,
  INK: 15
};
var AnnotationEditorParamsType = {
  RESIZE: 1,
  CREATE: 2,
  FREETEXT_SIZE: 11,
  FREETEXT_COLOR: 12,
  FREETEXT_OPACITY: 13,
  INK_COLOR: 21,
  INK_THICKNESS: 22,
  INK_OPACITY: 23,
  HIGHLIGHT_COLOR: 31,
  HIGHLIGHT_DEFAULT_COLOR: 32,
  HIGHLIGHT_THICKNESS: 33,
  HIGHLIGHT_FREE: 34,
  HIGHLIGHT_SHOW_ALL: 35,
  DRAW_STEP: 41
};
var PermissionFlag = {
  PRINT: 4,
  MODIFY_CONTENTS: 8,
  COPY: 16,
  MODIFY_ANNOTATIONS: 32,
  FILL_INTERACTIVE_FORMS: 256,
  COPY_FOR_ACCESSIBILITY: 512,
  ASSEMBLE: 1024,
  PRINT_HIGH_QUALITY: 2048
};
var TextRenderingMode = {
  FILL: 0,
  STROKE: 1,
  FILL_STROKE: 2,
  INVISIBLE: 3,
  FILL_ADD_TO_PATH: 4,
  STROKE_ADD_TO_PATH: 5,
  FILL_STROKE_ADD_TO_PATH: 6,
  ADD_TO_PATH: 7,
  FILL_STROKE_MASK: 3,
  ADD_TO_PATH_FLAG: 4
};
var util_ImageKind = {
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3
};
var AnnotationType = {
  TEXT: 1,
  LINK: 2,
  FREETEXT: 3,
  LINE: 4,
  SQUARE: 5,
  CIRCLE: 6,
  POLYGON: 7,
  POLYLINE: 8,
  HIGHLIGHT: 9,
  UNDERLINE: 10,
  SQUIGGLY: 11,
  STRIKEOUT: 12,
  STAMP: 13,
  CARET: 14,
  INK: 15,
  POPUP: 16,
  FILEATTACHMENT: 17,
  SOUND: 18,
  MOVIE: 19,
  WIDGET: 20,
  SCREEN: 21,
  PRINTERMARK: 22,
  TRAPNET: 23,
  WATERMARK: 24,
  THREED: 25,
  REDACT: 26
};
var AnnotationBorderStyleType = {
  SOLID: 1,
  DASHED: 2,
  BEVELED: 3,
  INSET: 4,
  UNDERLINE: 5
};
var VerbosityLevel = {
  ERRORS: 0,
  WARNINGS: 1,
  INFOS: 5
};
var OPS = {
  dependency: 1,
  setLineWidth: 2,
  setLineCap: 3,
  setLineJoin: 4,
  setMiterLimit: 5,
  setDash: 6,
  setRenderingIntent: 7,
  setFlatness: 8,
  setGState: 9,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  beginText: 31,
  endText: 32,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRenderingMode: 38,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  setCharWidth: 48,
  setCharWidthAndBounds: 49,
  setStrokeColorSpace: 50,
  setFillColorSpace: 51,
  setStrokeColor: 52,
  setStrokeColorN: 53,
  setFillColor: 54,
  setFillColorN: 55,
  setStrokeGray: 56,
  setFillGray: 57,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  setStrokeCMYKColor: 60,
  setFillCMYKColor: 61,
  shadingFill: 62,
  beginInlineImage: 63,
  beginImageData: 64,
  endInlineImage: 65,
  paintXObject: 66,
  markPoint: 67,
  markPointProps: 68,
  beginMarkedContent: 69,
  beginMarkedContentProps: 70,
  endMarkedContent: 71,
  beginCompat: 72,
  endCompat: 73,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  beginAnnotation: 80,
  endAnnotation: 81,
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
  paintSolidColorImageMask: 90,
  constructPath: 91,
  setStrokeTransparent: 92,
  setFillTransparent: 93
};
var PasswordResponses = {
  NEED_PASSWORD: 1,
  INCORRECT_PASSWORD: 2
};
var verbosity = VerbosityLevel.WARNINGS;
function setVerbosityLevel(level) {
  if (Number.isInteger(level)) {
    verbosity = level;
  }
}
function getVerbosityLevel() {
  return verbosity;
}
function info(msg) {
  if (verbosity >= VerbosityLevel.INFOS) {
    console.log(`Info: ${msg}`);
  }
}
function warn(msg) {
  if (verbosity >= VerbosityLevel.WARNINGS) {
    console.log(`Warning: ${msg}`);
  }
}
function unreachable(msg) {
  throw new Error(msg);
}
function assert(cond, msg) {
  if (!cond) {
    unreachable(msg);
  }
}
function _isValidProtocol(url) {
  switch (url?.protocol) {
    case "http:":
    case "https:":
    case "ftp:":
    case "mailto:":
    case "tel:":
      return true;
    default:
      return false;
  }
}
function createValidAbsoluteUrl(url, baseUrl = null, options = null) {
  if (!url) {
    return null;
  }
  try {
    if (options && typeof url === "string") {
      if (options.addDefaultProtocol && url.startsWith("www.")) {
        const dots = url.match(/\./g);
        if (dots?.length >= 2) {
          url = `http://${url}`;
        }
      }
      if (options.tryConvertEncoding) {
        try {
          url = stringToUTF8String(url);
        } catch {
        }
      }
    }
    const absoluteUrl = baseUrl ? new URL(url, baseUrl) : new URL(url);
    if (_isValidProtocol(absoluteUrl)) {
      return absoluteUrl;
    }
  } catch {
  }
  return null;
}
function shadow(obj, prop, value, nonSerializable = false) {
  Object.defineProperty(obj, prop, {
    value,
    enumerable: !nonSerializable,
    configurable: true,
    writable: false
  });
  return value;
}
var BaseException = (function BaseExceptionClosure() {
  function BaseException2(message, name) {
    this.message = message;
    this.name = name;
  }
  BaseException2.prototype = new Error();
  BaseException2.constructor = BaseException2;
  return BaseException2;
})();
var PasswordException = class extends BaseException {
  constructor(msg, code) {
    super(msg, "PasswordException");
    this.code = code;
  }
};
var UnknownErrorException = class extends BaseException {
  constructor(msg, details) {
    super(msg, "UnknownErrorException");
    this.details = details;
  }
};
var InvalidPDFException = class extends BaseException {
  constructor(msg) {
    super(msg, "InvalidPDFException");
  }
};
var MissingPDFException = class extends BaseException {
  constructor(msg) {
    super(msg, "MissingPDFException");
  }
};
var UnexpectedResponseException = class extends BaseException {
  constructor(msg, status) {
    super(msg, "UnexpectedResponseException");
    this.status = status;
  }
};
var FormatError = class extends BaseException {
  constructor(msg) {
    super(msg, "FormatError");
  }
};
var AbortException = class extends BaseException {
  constructor(msg) {
    super(msg, "AbortException");
  }
};
function bytesToString(bytes) {
  if (typeof bytes !== "object" || bytes?.length === void 0) {
    unreachable("Invalid argument for bytesToString");
  }
  const length = bytes.length;
  const MAX_ARGUMENT_COUNT = 8192;
  if (length < MAX_ARGUMENT_COUNT) {
    return String.fromCharCode.apply(null, bytes);
  }
  const strBuf = [];
  for (let i = 0; i < length; i += MAX_ARGUMENT_COUNT) {
    const chunkEnd = Math.min(i + MAX_ARGUMENT_COUNT, length);
    const chunk = bytes.subarray(i, chunkEnd);
    strBuf.push(String.fromCharCode.apply(null, chunk));
  }
  return strBuf.join("");
}
function stringToBytes(str) {
  if (typeof str !== "string") {
    unreachable("Invalid argument for stringToBytes");
  }
  const length = str.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; ++i) {
    bytes[i] = str.charCodeAt(i) & 255;
  }
  return bytes;
}
function string32(value) {
  return String.fromCharCode(value >> 24 & 255, value >> 16 & 255, value >> 8 & 255, value & 255);
}
function objectFromMap(map) {
  const obj = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of map) {
    obj[key] = value;
  }
  return obj;
}
function isLittleEndian() {
  const buffer8 = new Uint8Array(4);
  buffer8[0] = 1;
  const view32 = new Uint32Array(buffer8.buffer, 0, 1);
  return view32[0] === 1;
}
function isEvalSupported() {
  try {
    new Function("");
    return true;
  } catch {
    return false;
  }
}
var util_FeatureTest = class {
  static get isLittleEndian() {
    return shadow(this, "isLittleEndian", isLittleEndian());
  }
  static get isEvalSupported() {
    return shadow(this, "isEvalSupported", isEvalSupported());
  }
  static get isOffscreenCanvasSupported() {
    return shadow(this, "isOffscreenCanvasSupported", typeof OffscreenCanvas !== "undefined");
  }
  static get isImageDecoderSupported() {
    return shadow(this, "isImageDecoderSupported", typeof ImageDecoder !== "undefined");
  }
  static get platform() {
    if (typeof navigator !== "undefined" && typeof navigator?.platform === "string") {
      return shadow(this, "platform", {
        isMac: navigator.platform.includes("Mac"),
        isWindows: navigator.platform.includes("Win"),
        isFirefox: typeof navigator?.userAgent === "string" && navigator.userAgent.includes("Firefox")
      });
    }
    return shadow(this, "platform", {
      isMac: false,
      isWindows: false,
      isFirefox: false
    });
  }
  static get isCSSRoundSupported() {
    return shadow(this, "isCSSRoundSupported", globalThis.CSS?.supports?.("width: round(1.5px, 1px)"));
  }
};
var hexNumbers = Array.from(Array(256).keys(), (n) => n.toString(16).padStart(2, "0"));
var Util = class {
  static makeHexColor(r, g, b) {
    return `#${hexNumbers[r]}${hexNumbers[g]}${hexNumbers[b]}`;
  }
  static scaleMinMax(transform, minMax) {
    let temp;
    if (transform[0]) {
      if (transform[0] < 0) {
        temp = minMax[0];
        minMax[0] = minMax[2];
        minMax[2] = temp;
      }
      minMax[0] *= transform[0];
      minMax[2] *= transform[0];
      if (transform[3] < 0) {
        temp = minMax[1];
        minMax[1] = minMax[3];
        minMax[3] = temp;
      }
      minMax[1] *= transform[3];
      minMax[3] *= transform[3];
    } else {
      temp = minMax[0];
      minMax[0] = minMax[1];
      minMax[1] = temp;
      temp = minMax[2];
      minMax[2] = minMax[3];
      minMax[3] = temp;
      if (transform[1] < 0) {
        temp = minMax[1];
        minMax[1] = minMax[3];
        minMax[3] = temp;
      }
      minMax[1] *= transform[1];
      minMax[3] *= transform[1];
      if (transform[2] < 0) {
        temp = minMax[0];
        minMax[0] = minMax[2];
        minMax[2] = temp;
      }
      minMax[0] *= transform[2];
      minMax[2] *= transform[2];
    }
    minMax[0] += transform[4];
    minMax[1] += transform[5];
    minMax[2] += transform[4];
    minMax[3] += transform[5];
  }
  static transform(m1, m2) {
    return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
  }
  static applyTransform(p, m) {
    const xt = p[0] * m[0] + p[1] * m[2] + m[4];
    const yt = p[0] * m[1] + p[1] * m[3] + m[5];
    return [xt, yt];
  }
  static applyInverseTransform(p, m) {
    const d = m[0] * m[3] - m[1] * m[2];
    const xt = (p[0] * m[3] - p[1] * m[2] + m[2] * m[5] - m[4] * m[3]) / d;
    const yt = (-p[0] * m[1] + p[1] * m[0] + m[4] * m[1] - m[5] * m[0]) / d;
    return [xt, yt];
  }
  static getAxialAlignedBoundingBox(r, m) {
    const p1 = this.applyTransform(r, m);
    const p2 = this.applyTransform(r.slice(2, 4), m);
    const p3 = this.applyTransform([r[0], r[3]], m);
    const p4 = this.applyTransform([r[2], r[1]], m);
    return [Math.min(p1[0], p2[0], p3[0], p4[0]), Math.min(p1[1], p2[1], p3[1], p4[1]), Math.max(p1[0], p2[0], p3[0], p4[0]), Math.max(p1[1], p2[1], p3[1], p4[1])];
  }
  static inverseTransform(m) {
    const d = m[0] * m[3] - m[1] * m[2];
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[4] * m[3]) / d, (m[4] * m[1] - m[5] * m[0]) / d];
  }
  static singularValueDecompose2dScale(m) {
    const transpose = [m[0], m[2], m[1], m[3]];
    const a = m[0] * transpose[0] + m[1] * transpose[2];
    const b = m[0] * transpose[1] + m[1] * transpose[3];
    const c = m[2] * transpose[0] + m[3] * transpose[2];
    const d = m[2] * transpose[1] + m[3] * transpose[3];
    const first = (a + d) / 2;
    const second = Math.sqrt((a + d) ** 2 - 4 * (a * d - c * b)) / 2;
    const sx = first + second || 1;
    const sy = first - second || 1;
    return [Math.sqrt(sx), Math.sqrt(sy)];
  }
  static normalizeRect(rect) {
    const r = rect.slice(0);
    if (rect[0] > rect[2]) {
      r[0] = rect[2];
      r[2] = rect[0];
    }
    if (rect[1] > rect[3]) {
      r[1] = rect[3];
      r[3] = rect[1];
    }
    return r;
  }
  static intersect(rect1, rect2) {
    const xLow = Math.max(Math.min(rect1[0], rect1[2]), Math.min(rect2[0], rect2[2]));
    const xHigh = Math.min(Math.max(rect1[0], rect1[2]), Math.max(rect2[0], rect2[2]));
    if (xLow > xHigh) {
      return null;
    }
    const yLow = Math.max(Math.min(rect1[1], rect1[3]), Math.min(rect2[1], rect2[3]));
    const yHigh = Math.min(Math.max(rect1[1], rect1[3]), Math.max(rect2[1], rect2[3]));
    if (yLow > yHigh) {
      return null;
    }
    return [xLow, yLow, xHigh, yHigh];
  }
  static #getExtremumOnCurve(x0, x1, x2, x3, y0, y1, y2, y3, t, minMax) {
    if (t <= 0 || t >= 1) {
      return;
    }
    const mt = 1 - t;
    const tt = t * t;
    const ttt = tt * t;
    const x = mt * (mt * (mt * x0 + 3 * t * x1) + 3 * tt * x2) + ttt * x3;
    const y = mt * (mt * (mt * y0 + 3 * t * y1) + 3 * tt * y2) + ttt * y3;
    minMax[0] = Math.min(minMax[0], x);
    minMax[1] = Math.min(minMax[1], y);
    minMax[2] = Math.max(minMax[2], x);
    minMax[3] = Math.max(minMax[3], y);
  }
  static #getExtremum(x0, x1, x2, x3, y0, y1, y2, y3, a, b, c, minMax) {
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) >= 1e-12) {
        this.#getExtremumOnCurve(x0, x1, x2, x3, y0, y1, y2, y3, -c / b, minMax);
      }
      return;
    }
    const delta = b ** 2 - 4 * c * a;
    if (delta < 0) {
      return;
    }
    const sqrtDelta = Math.sqrt(delta);
    const a2 = 2 * a;
    this.#getExtremumOnCurve(x0, x1, x2, x3, y0, y1, y2, y3, (-b + sqrtDelta) / a2, minMax);
    this.#getExtremumOnCurve(x0, x1, x2, x3, y0, y1, y2, y3, (-b - sqrtDelta) / a2, minMax);
  }
  static bezierBoundingBox(x0, y0, x1, y1, x2, y2, x3, y3, minMax) {
    if (minMax) {
      minMax[0] = Math.min(minMax[0], x0, x3);
      minMax[1] = Math.min(minMax[1], y0, y3);
      minMax[2] = Math.max(minMax[2], x0, x3);
      minMax[3] = Math.max(minMax[3], y0, y3);
    } else {
      minMax = [Math.min(x0, x3), Math.min(y0, y3), Math.max(x0, x3), Math.max(y0, y3)];
    }
    this.#getExtremum(x0, x1, x2, x3, y0, y1, y2, y3, 3 * (-x0 + 3 * (x1 - x2) + x3), 6 * (x0 - 2 * x1 + x2), 3 * (x1 - x0), minMax);
    this.#getExtremum(x0, x1, x2, x3, y0, y1, y2, y3, 3 * (-y0 + 3 * (y1 - y2) + y3), 6 * (y0 - 2 * y1 + y2), 3 * (y1 - y0), minMax);
    return minMax;
  }
};
function stringToUTF8String(str) {
  return decodeURIComponent(escape(str));
}
var NormalizeRegex = null;
var NormalizationMap = null;
function normalizeUnicode(str) {
  if (!NormalizeRegex) {
    NormalizeRegex = /([\u00a0\u00b5\u037e\u0eb3\u2000-\u200a\u202f\u2126\ufb00-\ufb04\ufb06\ufb20-\ufb36\ufb38-\ufb3c\ufb3e\ufb40-\ufb41\ufb43-\ufb44\ufb46-\ufba1\ufba4-\ufba9\ufbae-\ufbb1\ufbd3-\ufbdc\ufbde-\ufbe7\ufbea-\ufbf8\ufbfc-\ufbfd\ufc00-\ufc5d\ufc64-\ufcf1\ufcf5-\ufd3d\ufd88\ufdf4\ufdfa-\ufdfb\ufe71\ufe77\ufe79\ufe7b\ufe7d]+)|(\ufb05+)/gu;
    NormalizationMap = /* @__PURE__ */ new Map([["\uFB05", "\u017Ft"]]);
  }
  return str.replaceAll(NormalizeRegex, (_, p1, p2) => p1 ? p1.normalize("NFKC") : NormalizationMap.get(p2));
}
function getUuid() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToString(buf);
}
var AnnotationPrefix = "pdfjs_internal_id_";
function toBase64Util(arr) {
  if (Uint8Array.prototype.toBase64) {
    return arr.toBase64();
  }
  return btoa(bytesToString(arr));
}
var es_promise_with_resolvers = __webpack_require__(4628);
var es_set_difference_v2 = __webpack_require__(7642);
var es_set_intersection_v2 = __webpack_require__(8004);
var es_set_is_disjoint_from_v2 = __webpack_require__(3853);
var es_set_is_subset_of_v2 = __webpack_require__(5876);
var es_set_is_superset_of_v2 = __webpack_require__(2475);
var es_set_symmetric_difference_v2 = __webpack_require__(5024);
var es_set_union_v2 = __webpack_require__(1698);
var esnext_iterator_map = __webpack_require__(1454);
var esnext_iterator_constructor = __webpack_require__(8992);
var esnext_iterator_drop = __webpack_require__(4743);
var esnext_iterator_every = __webpack_require__(3215);
var esnext_iterator_some = __webpack_require__(7550);
var esnext_json_parse = __webpack_require__(8335);
var SVG_NS = "http://www.w3.org/2000/svg";
var PixelsPerInch = class {
  static CSS = 96;
  static PDF = 72;
  static PDF_TO_CSS_UNITS = this.CSS / this.PDF;
};
async function fetchData(url, type = "text") {
  if (isValidFetchUrl(url, document.baseURI)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    switch (type) {
      case "arraybuffer":
        return response.arrayBuffer();
      case "blob":
        return response.blob();
      case "json":
        return response.json();
    }
    return response.text();
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = type;
    request.onreadystatechange = () => {
      if (request.readyState !== XMLHttpRequest.DONE) {
        return;
      }
      if (request.status === 200 || request.status === 0) {
        switch (type) {
          case "arraybuffer":
          case "blob":
          case "json":
            resolve(request.response);
            return;
        }
        resolve(request.responseText);
        return;
      }
      reject(new Error(request.statusText));
    };
    request.send(null);
  });
}
var PageViewport = class _PageViewport {
  constructor({
    viewBox,
    userUnit,
    scale,
    rotation,
    offsetX = 0,
    offsetY = 0,
    dontFlip = false
  }) {
    this.viewBox = viewBox;
    this.userUnit = userUnit;
    this.scale = scale;
    this.rotation = rotation;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    scale *= userUnit;
    const centerX = (viewBox[2] + viewBox[0]) / 2;
    const centerY = (viewBox[3] + viewBox[1]) / 2;
    let rotateA, rotateB, rotateC, rotateD;
    rotation %= 360;
    if (rotation < 0) {
      rotation += 360;
    }
    switch (rotation) {
      case 180:
        rotateA = -1;
        rotateB = 0;
        rotateC = 0;
        rotateD = 1;
        break;
      case 90:
        rotateA = 0;
        rotateB = 1;
        rotateC = 1;
        rotateD = 0;
        break;
      case 270:
        rotateA = 0;
        rotateB = -1;
        rotateC = -1;
        rotateD = 0;
        break;
      case 0:
        rotateA = 1;
        rotateB = 0;
        rotateC = 0;
        rotateD = -1;
        break;
      default:
        throw new Error("PageViewport: Invalid rotation, must be a multiple of 90 degrees.");
    }
    if (dontFlip) {
      rotateC = -rotateC;
      rotateD = -rotateD;
    }
    let offsetCanvasX, offsetCanvasY;
    let width, height;
    if (rotateA === 0) {
      offsetCanvasX = Math.abs(centerY - viewBox[1]) * scale + offsetX;
      offsetCanvasY = Math.abs(centerX - viewBox[0]) * scale + offsetY;
      width = (viewBox[3] - viewBox[1]) * scale;
      height = (viewBox[2] - viewBox[0]) * scale;
    } else {
      offsetCanvasX = Math.abs(centerX - viewBox[0]) * scale + offsetX;
      offsetCanvasY = Math.abs(centerY - viewBox[1]) * scale + offsetY;
      width = (viewBox[2] - viewBox[0]) * scale;
      height = (viewBox[3] - viewBox[1]) * scale;
    }
    this.transform = [rotateA * scale, rotateB * scale, rotateC * scale, rotateD * scale, offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY, offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY];
    this.width = width;
    this.height = height;
  }
  get rawDims() {
    const {
      userUnit,
      viewBox
    } = this;
    const dims = viewBox.map((x) => x * userUnit);
    return shadow(this, "rawDims", {
      pageWidth: dims[2] - dims[0],
      pageHeight: dims[3] - dims[1],
      pageX: dims[0],
      pageY: dims[1]
    });
  }
  clone({
    scale = this.scale,
    rotation = this.rotation,
    offsetX = this.offsetX,
    offsetY = this.offsetY,
    dontFlip = false
  } = {}) {
    return new _PageViewport({
      viewBox: this.viewBox.slice(),
      userUnit: this.userUnit,
      scale,
      rotation,
      offsetX,
      offsetY,
      dontFlip
    });
  }
  convertToViewportPoint(x, y) {
    return Util.applyTransform([x, y], this.transform);
  }
  convertToViewportRectangle(rect) {
    const topLeft = Util.applyTransform([rect[0], rect[1]], this.transform);
    const bottomRight = Util.applyTransform([rect[2], rect[3]], this.transform);
    return [topLeft[0], topLeft[1], bottomRight[0], bottomRight[1]];
  }
  convertToPdfPoint(x, y) {
    return Util.applyInverseTransform([x, y], this.transform);
  }
};
var RenderingCancelledException = class extends BaseException {
  constructor(msg, extraDelay = 0) {
    super(msg, "RenderingCancelledException");
    this.extraDelay = extraDelay;
  }
};
function isDataScheme(url) {
  const ii = url.length;
  let i = 0;
  while (i < ii && url[i].trim() === "") {
    i++;
  }
  return url.substring(i, i + 5).toLowerCase() === "data:";
}
function isPdfFile(filename) {
  return typeof filename === "string" && /\.pdf$/i.test(filename);
}
function getFilenameFromUrl(url) {
  [url] = url.split(/[#?]/, 1);
  return url.substring(url.lastIndexOf("/") + 1);
}
function getPdfFilenameFromUrl(url, defaultFilename = "document.pdf") {
  if (typeof url !== "string") {
    return defaultFilename;
  }
  if (isDataScheme(url)) {
    warn('getPdfFilenameFromUrl: ignore "data:"-URL for performance reasons.');
    return defaultFilename;
  }
  const reURI = /^(?:(?:[^:]+:)?\/\/[^/]+)?([^?#]*)(\?[^#]*)?(#.*)?$/;
  const reFilename = /[^/?#=]+\.pdf\b(?!.*\.pdf\b)/i;
  const splitURI = reURI.exec(url);
  let suggestedFilename = reFilename.exec(splitURI[1]) || reFilename.exec(splitURI[2]) || reFilename.exec(splitURI[3]);
  if (suggestedFilename) {
    suggestedFilename = suggestedFilename[0];
    if (suggestedFilename.includes("%")) {
      try {
        suggestedFilename = reFilename.exec(decodeURIComponent(suggestedFilename))[0];
      } catch {
      }
    }
  }
  return suggestedFilename || defaultFilename;
}
var StatTimer = class {
  started = /* @__PURE__ */ Object.create(null);
  times = [];
  time(name) {
    if (name in this.started) {
      warn(`Timer is already running for ${name}`);
    }
    this.started[name] = Date.now();
  }
  timeEnd(name) {
    if (!(name in this.started)) {
      warn(`Timer has not been started for ${name}`);
    }
    this.times.push({
      name,
      start: this.started[name],
      end: Date.now()
    });
    delete this.started[name];
  }
  toString() {
    const outBuf = [];
    let longest = 0;
    for (const {
      name
    } of this.times) {
      longest = Math.max(name.length, longest);
    }
    for (const {
      name,
      start,
      end
    } of this.times) {
      outBuf.push(`${name.padEnd(longest)} ${end - start}ms
`);
    }
    return outBuf.join("");
  }
};
function isValidFetchUrl(url, baseUrl) {
  try {
    const {
      protocol
    } = baseUrl ? new URL(url, baseUrl) : new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
function noContextMenu(e) {
  e.preventDefault();
}
function stopEvent(e) {
  e.preventDefault();
  e.stopPropagation();
}
var PDFDateString = class {
  static #regex;
  static toDateObject(input) {
    if (!input || typeof input !== "string") {
      return null;
    }
    this.#regex ||= new RegExp("^D:(\\d{4})(\\d{2})?(\\d{2})?(\\d{2})?(\\d{2})?(\\d{2})?([Z|+|-])?(\\d{2})?'?(\\d{2})?'?");
    const matches = this.#regex.exec(input);
    if (!matches) {
      return null;
    }
    const year = parseInt(matches[1], 10);
    let month = parseInt(matches[2], 10);
    month = month >= 1 && month <= 12 ? month - 1 : 0;
    let day = parseInt(matches[3], 10);
    day = day >= 1 && day <= 31 ? day : 1;
    let hour = parseInt(matches[4], 10);
    hour = hour >= 0 && hour <= 23 ? hour : 0;
    let minute = parseInt(matches[5], 10);
    minute = minute >= 0 && minute <= 59 ? minute : 0;
    let second = parseInt(matches[6], 10);
    second = second >= 0 && second <= 59 ? second : 0;
    const universalTimeRelation = matches[7] || "Z";
    let offsetHour = parseInt(matches[8], 10);
    offsetHour = offsetHour >= 0 && offsetHour <= 23 ? offsetHour : 0;
    let offsetMinute = parseInt(matches[9], 10) || 0;
    offsetMinute = offsetMinute >= 0 && offsetMinute <= 59 ? offsetMinute : 0;
    if (universalTimeRelation === "-") {
      hour += offsetHour;
      minute += offsetMinute;
    } else if (universalTimeRelation === "+") {
      hour -= offsetHour;
      minute -= offsetMinute;
    }
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
};
function getXfaPageViewport(xfaPage, {
  scale = 1,
  rotation = 0
}) {
  const {
    width,
    height
  } = xfaPage.attributes.style;
  const viewBox = [0, 0, parseInt(width), parseInt(height)];
  return new PageViewport({
    viewBox,
    userUnit: 1,
    scale,
    rotation
  });
}
function getRGB(color) {
  if (color.startsWith("#")) {
    const colorRGB = parseInt(color.slice(1), 16);
    return [(colorRGB & 16711680) >> 16, (colorRGB & 65280) >> 8, colorRGB & 255];
  }
  if (color.startsWith("rgb(")) {
    return color.slice(4, -1).split(",").map((x) => parseInt(x));
  }
  if (color.startsWith("rgba(")) {
    return color.slice(5, -1).split(",").map((x) => parseInt(x)).slice(0, 3);
  }
  warn(`Not a valid color format: "${color}"`);
  return [0, 0, 0];
}
function getColorValues(colors) {
  const span = document.createElement("span");
  span.style.visibility = "hidden";
  document.body.append(span);
  for (const name of colors.keys()) {
    span.style.color = name;
    const computedColor = window.getComputedStyle(span).color;
    colors.set(name, getRGB(computedColor));
  }
  span.remove();
}
function getCurrentTransform(ctx) {
  const {
    a,
    b,
    c,
    d,
    e,
    f
  } = ctx.getTransform();
  return [a, b, c, d, e, f];
}
function getCurrentTransformInverse(ctx) {
  const {
    a,
    b,
    c,
    d,
    e,
    f
  } = ctx.getTransform().invertSelf();
  return [a, b, c, d, e, f];
}
function setLayerDimensions(div, viewport, mustFlip = false, mustRotate = true) {
  if (viewport instanceof PageViewport) {
    const {
      pageWidth,
      pageHeight
    } = viewport.rawDims;
    const {
      style
    } = div;
    const useRound = util_FeatureTest.isCSSRoundSupported;
    const w = `var(--scale-factor) * ${pageWidth}px`, h = `var(--scale-factor) * ${pageHeight}px`;
    const widthStr = useRound ? `round(down, ${w}, var(--scale-round-x, 1px))` : `calc(${w})`, heightStr = useRound ? `round(down, ${h}, var(--scale-round-y, 1px))` : `calc(${h})`;
    if (!mustFlip || viewport.rotation % 180 === 0) {
      style.width = widthStr;
      style.height = heightStr;
    } else {
      style.width = heightStr;
      style.height = widthStr;
    }
  }
  if (mustRotate) {
    div.setAttribute("data-main-rotation", viewport.rotation);
  }
}
var OutputScale = class {
  constructor() {
    const pixelRatio = window.devicePixelRatio || 1;
    this.sx = pixelRatio;
    this.sy = pixelRatio;
  }
  get scaled() {
    return this.sx !== 1 || this.sy !== 1;
  }
  get symmetric() {
    return this.sx === this.sy;
  }
};
var EditorToolbar = class _EditorToolbar {
  #toolbar = null;
  #colorPicker = null;
  #editor;
  #buttons = null;
  #altText = null;
  static #l10nRemove = null;
  constructor(editor) {
    this.#editor = editor;
    _EditorToolbar.#l10nRemove ||= Object.freeze({
      freetext: "pdfjs-editor-remove-freetext-button",
      highlight: "pdfjs-editor-remove-highlight-button",
      ink: "pdfjs-editor-remove-ink-button",
      stamp: "pdfjs-editor-remove-stamp-button"
    });
  }
  render() {
    const editToolbar = this.#toolbar = document.createElement("div");
    editToolbar.classList.add("editToolbar", "hidden");
    editToolbar.setAttribute("role", "toolbar");
    const signal = this.#editor._uiManager._signal;
    editToolbar.addEventListener("contextmenu", noContextMenu, {
      signal
    });
    editToolbar.addEventListener("pointerdown", _EditorToolbar.#pointerDown, {
      signal
    });
    const buttons = this.#buttons = document.createElement("div");
    buttons.className = "buttons";
    editToolbar.append(buttons);
    const position = this.#editor.toolbarPosition;
    if (position) {
      const {
        style
      } = editToolbar;
      const x = this.#editor._uiManager.direction === "ltr" ? 1 - position[0] : position[0];
      style.insetInlineEnd = `${100 * x}%`;
      style.top = `calc(${100 * position[1]}% + var(--editor-toolbar-vert-offset))`;
    }
    this.#addDeleteButton();
    return editToolbar;
  }
  get div() {
    return this.#toolbar;
  }
  static #pointerDown(e) {
    e.stopPropagation();
  }
  #focusIn(e) {
    this.#editor._focusEventsAllowed = false;
    stopEvent(e);
  }
  #focusOut(e) {
    this.#editor._focusEventsAllowed = true;
    stopEvent(e);
  }
  #addListenersToElement(element) {
    const signal = this.#editor._uiManager._signal;
    element.addEventListener("focusin", this.#focusIn.bind(this), {
      capture: true,
      signal
    });
    element.addEventListener("focusout", this.#focusOut.bind(this), {
      capture: true,
      signal
    });
    element.addEventListener("contextmenu", noContextMenu, {
      signal
    });
  }
  hide() {
    this.#toolbar.classList.add("hidden");
    this.#colorPicker?.hideDropdown();
  }
  show() {
    this.#toolbar.classList.remove("hidden");
    this.#altText?.shown();
  }
  #addDeleteButton() {
    const {
      editorType,
      _uiManager
    } = this.#editor;
    const button = document.createElement("button");
    button.className = "delete";
    button.tabIndex = 0;
    button.setAttribute("data-l10n-id", _EditorToolbar.#l10nRemove[editorType]);
    this.#addListenersToElement(button);
    button.addEventListener("click", (e) => {
      _uiManager.delete();
    }, {
      signal: _uiManager._signal
    });
    this.#buttons.append(button);
  }
  get #divider() {
    const divider = document.createElement("div");
    divider.className = "divider";
    return divider;
  }
  async addAltText(altText) {
    const button = await altText.render();
    this.#addListenersToElement(button);
    this.#buttons.prepend(button, this.#divider);
    this.#altText = altText;
  }
  addColorPicker(colorPicker) {
    this.#colorPicker = colorPicker;
    const button = colorPicker.renderButton();
    this.#addListenersToElement(button);
    this.#buttons.prepend(button, this.#divider);
  }
  remove() {
    this.#toolbar.remove();
    this.#colorPicker?.destroy();
    this.#colorPicker = null;
  }
};
var HighlightToolbar = class {
  #buttons = null;
  #toolbar = null;
  #uiManager;
  constructor(uiManager) {
    this.#uiManager = uiManager;
  }
  #render() {
    const editToolbar = this.#toolbar = document.createElement("div");
    editToolbar.className = "editToolbar";
    editToolbar.setAttribute("role", "toolbar");
    editToolbar.addEventListener("contextmenu", noContextMenu, {
      signal: this.#uiManager._signal
    });
    const buttons = this.#buttons = document.createElement("div");
    buttons.className = "buttons";
    editToolbar.append(buttons);
    this.#addHighlightButton();
    return editToolbar;
  }
  #getLastPoint(boxes, isLTR) {
    let lastY = 0;
    let lastX = 0;
    for (const box of boxes) {
      const y = box.y + box.height;
      if (y < lastY) {
        continue;
      }
      const x = box.x + (isLTR ? box.width : 0);
      if (y > lastY) {
        lastX = x;
        lastY = y;
        continue;
      }
      if (isLTR) {
        if (x > lastX) {
          lastX = x;
        }
      } else if (x < lastX) {
        lastX = x;
      }
    }
    return [isLTR ? 1 - lastX : lastX, lastY];
  }
  show(parent, boxes, isLTR) {
    const [x, y] = this.#getLastPoint(boxes, isLTR);
    const {
      style
    } = this.#toolbar ||= this.#render();
    parent.append(this.#toolbar);
    style.insetInlineEnd = `${100 * x}%`;
    style.top = `calc(${100 * y}% + var(--editor-toolbar-vert-offset))`;
  }
  hide() {
    this.#toolbar.remove();
  }
  #addHighlightButton() {
    const button = document.createElement("button");
    button.className = "highlightButton";
    button.tabIndex = 0;
    button.setAttribute("data-l10n-id", `pdfjs-highlight-floating-button1`);
    const span = document.createElement("span");
    button.append(span);
    span.className = "visuallyHidden";
    span.setAttribute("data-l10n-id", "pdfjs-highlight-floating-button-label");
    const signal = this.#uiManager._signal;
    button.addEventListener("contextmenu", noContextMenu, {
      signal
    });
    button.addEventListener("click", () => {
      this.#uiManager.highlightSelection("floating_button");
    }, {
      signal
    });
    this.#buttons.append(button);
  }
};
function bindEvents(obj, element, names) {
  for (const name of names) {
    element.addEventListener(name, obj[name].bind(obj));
  }
}
var IdManager = class {
  #id = 0;
  get id() {
    return `${AnnotationEditorPrefix}${this.#id++}`;
  }
};
var ImageManager = class _ImageManager {
  #baseId = getUuid();
  #id = 0;
  #cache = null;
  static get _isSVGFittingCanvas() {
    const svg = `data:image/svg+xml;charset=UTF-8,<svg viewBox="0 0 1 1" width="1" height="1" xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" style="fill:red;"/></svg>`;
    const canvas = new OffscreenCanvas(1, 3);
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true
    });
    const image = new Image();
    image.src = svg;
    const promise = image.decode().then(() => {
      ctx.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 3);
      return new Uint32Array(ctx.getImageData(0, 0, 1, 1).data.buffer)[0] === 0;
    });
    return shadow(this, "_isSVGFittingCanvas", promise);
  }
  async #get(key, rawData) {
    this.#cache ||= /* @__PURE__ */ new Map();
    let data = this.#cache.get(key);
    if (data === null) {
      return null;
    }
    if (data?.bitmap) {
      data.refCounter += 1;
      return data;
    }
    try {
      data ||= {
        bitmap: null,
        id: `image_${this.#baseId}_${this.#id++}`,
        refCounter: 0,
        isSvg: false
      };
      let image;
      if (typeof rawData === "string") {
        data.url = rawData;
        image = await fetchData(rawData, "blob");
      } else if (rawData instanceof File) {
        image = data.file = rawData;
      } else if (rawData instanceof Blob) {
        image = rawData;
      }
      if (image.type === "image/svg+xml") {
        const mustRemoveAspectRatioPromise = _ImageManager._isSVGFittingCanvas;
        const fileReader = new FileReader();
        const imageElement = new Image();
        const imagePromise = new Promise((resolve, reject) => {
          imageElement.onload = () => {
            data.bitmap = imageElement;
            data.isSvg = true;
            resolve();
          };
          fileReader.onload = async () => {
            const url = data.svgUrl = fileReader.result;
            imageElement.src = await mustRemoveAspectRatioPromise ? `${url}#svgView(preserveAspectRatio(none))` : url;
          };
          imageElement.onerror = fileReader.onerror = reject;
        });
        fileReader.readAsDataURL(image);
        await imagePromise;
      } else {
        data.bitmap = await createImageBitmap(image);
      }
      data.refCounter = 1;
    } catch (e) {
      warn(e);
      data = null;
    }
    this.#cache.set(key, data);
    if (data) {
      this.#cache.set(data.id, data);
    }
    return data;
  }
  async getFromFile(file) {
    const {
      lastModified,
      name,
      size,
      type
    } = file;
    return this.#get(`${lastModified}_${name}_${size}_${type}`, file);
  }
  async getFromUrl(url) {
    return this.#get(url, url);
  }
  async getFromBlob(id, blobPromise) {
    const blob = await blobPromise;
    return this.#get(id, blob);
  }
  async getFromId(id) {
    this.#cache ||= /* @__PURE__ */ new Map();
    const data = this.#cache.get(id);
    if (!data) {
      return null;
    }
    if (data.bitmap) {
      data.refCounter += 1;
      return data;
    }
    if (data.file) {
      return this.getFromFile(data.file);
    }
    if (data.blobPromise) {
      const {
        blobPromise
      } = data;
      delete data.blobPromise;
      return this.getFromBlob(data.id, blobPromise);
    }
    return this.getFromUrl(data.url);
  }
  getFromCanvas(id, canvas) {
    this.#cache ||= /* @__PURE__ */ new Map();
    let data = this.#cache.get(id);
    if (data?.bitmap) {
      data.refCounter += 1;
      return data;
    }
    const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = offscreen.getContext("2d");
    ctx.drawImage(canvas, 0, 0);
    data = {
      bitmap: offscreen.transferToImageBitmap(),
      id: `image_${this.#baseId}_${this.#id++}`,
      refCounter: 1,
      isSvg: false
    };
    this.#cache.set(id, data);
    this.#cache.set(data.id, data);
    return data;
  }
  getSvgUrl(id) {
    const data = this.#cache.get(id);
    if (!data?.isSvg) {
      return null;
    }
    return data.svgUrl;
  }
  deleteId(id) {
    this.#cache ||= /* @__PURE__ */ new Map();
    const data = this.#cache.get(id);
    if (!data) {
      return;
    }
    data.refCounter -= 1;
    if (data.refCounter !== 0) {
      return;
    }
    const {
      bitmap
    } = data;
    if (!data.url && !data.file) {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("bitmaprenderer");
      ctx.transferFromImageBitmap(bitmap);
      data.blobPromise = canvas.convertToBlob();
    }
    bitmap.close?.();
    data.bitmap = null;
  }
  isValidId(id) {
    return id.startsWith(`image_${this.#baseId}_`);
  }
};
var CommandManager = class {
  #commands = [];
  #locked = false;
  #maxSize;
  #position = -1;
  constructor(maxSize = 128) {
    this.#maxSize = maxSize;
  }
  add({
    cmd,
    undo,
    post,
    mustExec,
    type = NaN,
    overwriteIfSameType = false,
    keepUndo = false
  }) {
    if (mustExec) {
      cmd();
    }
    if (this.#locked) {
      return;
    }
    const save = {
      cmd,
      undo,
      post,
      type
    };
    if (this.#position === -1) {
      if (this.#commands.length > 0) {
        this.#commands.length = 0;
      }
      this.#position = 0;
      this.#commands.push(save);
      return;
    }
    if (overwriteIfSameType && this.#commands[this.#position].type === type) {
      if (keepUndo) {
        save.undo = this.#commands[this.#position].undo;
      }
      this.#commands[this.#position] = save;
      return;
    }
    const next = this.#position + 1;
    if (next === this.#maxSize) {
      this.#commands.splice(0, 1);
    } else {
      this.#position = next;
      if (next < this.#commands.length) {
        this.#commands.splice(next);
      }
    }
    this.#commands.push(save);
  }
  undo() {
    if (this.#position === -1) {
      return;
    }
    this.#locked = true;
    const {
      undo,
      post
    } = this.#commands[this.#position];
    undo();
    post?.();
    this.#locked = false;
    this.#position -= 1;
  }
  redo() {
    if (this.#position < this.#commands.length - 1) {
      this.#position += 1;
      this.#locked = true;
      const {
        cmd,
        post
      } = this.#commands[this.#position];
      cmd();
      post?.();
      this.#locked = false;
    }
  }
  hasSomethingToUndo() {
    return this.#position !== -1;
  }
  hasSomethingToRedo() {
    return this.#position < this.#commands.length - 1;
  }
  cleanType(type) {
    if (this.#position === -1) {
      return;
    }
    for (let i = this.#position; i >= 0; i--) {
      if (this.#commands[i].type !== type) {
        this.#commands.splice(i + 1, this.#position - i);
        this.#position = i;
        return;
      }
    }
    this.#commands.length = 0;
    this.#position = -1;
  }
  destroy() {
    this.#commands = null;
  }
};
var KeyboardManager = class {
  constructor(callbacks) {
    this.buffer = [];
    this.callbacks = /* @__PURE__ */ new Map();
    this.allKeys = /* @__PURE__ */ new Set();
    const {
      isMac
    } = util_FeatureTest.platform;
    for (const [keys, callback, options = {}] of callbacks) {
      for (const key of keys) {
        const isMacKey = key.startsWith("mac+");
        if (isMac && isMacKey) {
          this.callbacks.set(key.slice(4), {
            callback,
            options
          });
          this.allKeys.add(key.split("+").at(-1));
        } else if (!isMac && !isMacKey) {
          this.callbacks.set(key, {
            callback,
            options
          });
          this.allKeys.add(key.split("+").at(-1));
        }
      }
    }
  }
  #serialize(event) {
    if (event.altKey) {
      this.buffer.push("alt");
    }
    if (event.ctrlKey) {
      this.buffer.push("ctrl");
    }
    if (event.metaKey) {
      this.buffer.push("meta");
    }
    if (event.shiftKey) {
      this.buffer.push("shift");
    }
    this.buffer.push(event.key);
    const str = this.buffer.join("+");
    this.buffer.length = 0;
    return str;
  }
  exec(self2, event) {
    if (!this.allKeys.has(event.key)) {
      return;
    }
    const info2 = this.callbacks.get(this.#serialize(event));
    if (!info2) {
      return;
    }
    const {
      callback,
      options: {
        bubbles = false,
        args = [],
        checker = null
      }
    } = info2;
    if (checker && !checker(self2, event)) {
      return;
    }
    callback.bind(self2, ...args, event)();
    if (!bubbles) {
      stopEvent(event);
    }
  }
};
var ColorManager = class _ColorManager {
  static _colorsMapping = /* @__PURE__ */ new Map([["CanvasText", [0, 0, 0]], ["Canvas", [255, 255, 255]]]);
  get _colors() {
    const colors = /* @__PURE__ */ new Map([["CanvasText", null], ["Canvas", null]]);
    getColorValues(colors);
    return shadow(this, "_colors", colors);
  }
  convert(color) {
    const rgb = getRGB(color);
    if (!window.matchMedia("(forced-colors: active)").matches) {
      return rgb;
    }
    for (const [name, RGB] of this._colors) {
      if (RGB.every((x, i) => x === rgb[i])) {
        return _ColorManager._colorsMapping.get(name);
      }
    }
    return rgb;
  }
  getHexCode(name) {
    const rgb = this._colors.get(name);
    if (!rgb) {
      return name;
    }
    return Util.makeHexColor(...rgb);
  }
};
var AnnotationEditorUIManager = class _AnnotationEditorUIManager {
  #abortController = new AbortController();
  #activeEditor = null;
  #allEditors = /* @__PURE__ */ new Map();
  #allLayers = /* @__PURE__ */ new Map();
  #altTextManager = null;
  #annotationStorage = null;
  #changedExistingAnnotations = null;
  #commandManager = new CommandManager();
  #copyPasteAC = null;
  #currentDrawingSession = null;
  #currentPageIndex = 0;
  #deletedAnnotationsElementIds = /* @__PURE__ */ new Set();
  #draggingEditors = null;
  #editorTypes = null;
  #editorsToRescale = /* @__PURE__ */ new Set();
  _editorUndoBar = null;
  #enableHighlightFloatingButton = false;
  #enableUpdatedAddImage = false;
  #enableNewAltTextWhenAddingImage = false;
  #filterFactory = null;
  #focusMainContainerTimeoutId = null;
  #focusManagerAC = null;
  #highlightColors = null;
  #highlightWhenShiftUp = false;
  #highlightToolbar = null;
  #idManager = new IdManager();
  #isEnabled = false;
  #isWaiting = false;
  #keyboardManagerAC = null;
  #lastActiveElement = null;
  #mainHighlightColorPicker = null;
  #mlManager = null;
  #mode = AnnotationEditorType.NONE;
  #selectedEditors = /* @__PURE__ */ new Set();
  #selectedTextNode = null;
  #pageColors = null;
  #showAllStates = null;
  #previousStates = {
    isEditing: false,
    isEmpty: true,
    hasSomethingToUndo: false,
    hasSomethingToRedo: false,
    hasSelectedEditor: false,
    hasSelectedText: false
  };
  #translation = [0, 0];
  #translationTimeoutId = null;
  #container = null;
  #viewer = null;
  #updateModeCapability = null;
  static TRANSLATE_SMALL = 1;
  static TRANSLATE_BIG = 10;
  static get _keyboardManager() {
    const proto = _AnnotationEditorUIManager.prototype;
    const arrowChecker = (self2) => self2.#container.contains(document.activeElement) && document.activeElement.tagName !== "BUTTON" && self2.hasSomethingToControl();
    const textInputChecker = (_self, {
      target: el
    }) => {
      if (el instanceof HTMLInputElement) {
        const {
          type
        } = el;
        return type !== "text" && type !== "number";
      }
      return true;
    };
    const small = this.TRANSLATE_SMALL;
    const big = this.TRANSLATE_BIG;
    return shadow(this, "_keyboardManager", new KeyboardManager([[["ctrl+a", "mac+meta+a"], proto.selectAll, {
      checker: textInputChecker
    }], [["ctrl+z", "mac+meta+z"], proto.undo, {
      checker: textInputChecker
    }], [["ctrl+y", "ctrl+shift+z", "mac+meta+shift+z", "ctrl+shift+Z", "mac+meta+shift+Z"], proto.redo, {
      checker: textInputChecker
    }], [["Backspace", "alt+Backspace", "ctrl+Backspace", "shift+Backspace", "mac+Backspace", "mac+alt+Backspace", "mac+ctrl+Backspace", "Delete", "ctrl+Delete", "shift+Delete", "mac+Delete"], proto.delete, {
      checker: textInputChecker
    }], [["Enter", "mac+Enter"], proto.addNewEditorFromKeyboard, {
      checker: (self2, {
        target: el
      }) => !(el instanceof HTMLButtonElement) && self2.#container.contains(el) && !self2.isEnterHandled
    }], [[" ", "mac+ "], proto.addNewEditorFromKeyboard, {
      checker: (self2, {
        target: el
      }) => !(el instanceof HTMLButtonElement) && self2.#container.contains(document.activeElement)
    }], [["Escape", "mac+Escape"], proto.unselectAll], [["ArrowLeft", "mac+ArrowLeft"], proto.translateSelectedEditors, {
      args: [-small, 0],
      checker: arrowChecker
    }], [["ctrl+ArrowLeft", "mac+shift+ArrowLeft"], proto.translateSelectedEditors, {
      args: [-big, 0],
      checker: arrowChecker
    }], [["ArrowRight", "mac+ArrowRight"], proto.translateSelectedEditors, {
      args: [small, 0],
      checker: arrowChecker
    }], [["ctrl+ArrowRight", "mac+shift+ArrowRight"], proto.translateSelectedEditors, {
      args: [big, 0],
      checker: arrowChecker
    }], [["ArrowUp", "mac+ArrowUp"], proto.translateSelectedEditors, {
      args: [0, -small],
      checker: arrowChecker
    }], [["ctrl+ArrowUp", "mac+shift+ArrowUp"], proto.translateSelectedEditors, {
      args: [0, -big],
      checker: arrowChecker
    }], [["ArrowDown", "mac+ArrowDown"], proto.translateSelectedEditors, {
      args: [0, small],
      checker: arrowChecker
    }], [["ctrl+ArrowDown", "mac+shift+ArrowDown"], proto.translateSelectedEditors, {
      args: [0, big],
      checker: arrowChecker
    }]]));
  }
  constructor(container, viewer2, altTextManager, eventBus, pdfDocument2, pageColors, highlightColors, enableHighlightFloatingButton, enableUpdatedAddImage, enableNewAltTextWhenAddingImage, mlManager, editorUndoBar, supportsPinchToZoom) {
    const signal = this._signal = this.#abortController.signal;
    this.#container = container;
    this.#viewer = viewer2;
    this.#altTextManager = altTextManager;
    this._eventBus = eventBus;
    eventBus._on("editingaction", this.onEditingAction.bind(this), {
      signal
    });
    eventBus._on("pagechanging", this.onPageChanging.bind(this), {
      signal
    });
    eventBus._on("scalechanging", this.onScaleChanging.bind(this), {
      signal
    });
    eventBus._on("rotationchanging", this.onRotationChanging.bind(this), {
      signal
    });
    eventBus._on("setpreference", this.onSetPreference.bind(this), {
      signal
    });
    eventBus._on("switchannotationeditorparams", (evt) => this.updateParams(evt.type, evt.value), {
      signal
    });
    this.#addSelectionListener();
    this.#addDragAndDropListeners();
    this.#addKeyboardManager();
    this.#annotationStorage = pdfDocument2.annotationStorage;
    this.#filterFactory = pdfDocument2.filterFactory;
    this.#pageColors = pageColors;
    this.#highlightColors = highlightColors || null;
    this.#enableHighlightFloatingButton = enableHighlightFloatingButton;
    this.#enableUpdatedAddImage = enableUpdatedAddImage;
    this.#enableNewAltTextWhenAddingImage = enableNewAltTextWhenAddingImage;
    this.#mlManager = mlManager || null;
    this.viewParameters = {
      realScale: PixelsPerInch.PDF_TO_CSS_UNITS,
      rotation: 0
    };
    this.isShiftKeyDown = false;
    this._editorUndoBar = editorUndoBar || null;
    this._supportsPinchToZoom = supportsPinchToZoom !== false;
  }
  destroy() {
    this.#updateModeCapability?.resolve();
    this.#updateModeCapability = null;
    this.#abortController?.abort();
    this.#abortController = null;
    this._signal = null;
    for (const layer of this.#allLayers.values()) {
      layer.destroy();
    }
    this.#allLayers.clear();
    this.#allEditors.clear();
    this.#editorsToRescale.clear();
    this.#activeEditor = null;
    this.#selectedEditors.clear();
    this.#commandManager.destroy();
    this.#altTextManager?.destroy();
    this.#highlightToolbar?.hide();
    this.#highlightToolbar = null;
    if (this.#focusMainContainerTimeoutId) {
      clearTimeout(this.#focusMainContainerTimeoutId);
      this.#focusMainContainerTimeoutId = null;
    }
    if (this.#translationTimeoutId) {
      clearTimeout(this.#translationTimeoutId);
      this.#translationTimeoutId = null;
    }
    this._editorUndoBar?.destroy();
  }
  combinedSignal(ac) {
    return AbortSignal.any([this._signal, ac.signal]);
  }
  get mlManager() {
    return this.#mlManager;
  }
  get useNewAltTextFlow() {
    return this.#enableUpdatedAddImage;
  }
  get useNewAltTextWhenAddingImage() {
    return this.#enableNewAltTextWhenAddingImage;
  }
  get hcmFilter() {
    return shadow(this, "hcmFilter", this.#pageColors ? this.#filterFactory.addHCMFilter(this.#pageColors.foreground, this.#pageColors.background) : "none");
  }
  get direction() {
    return shadow(this, "direction", getComputedStyle(this.#container).direction);
  }
  get highlightColors() {
    return shadow(this, "highlightColors", this.#highlightColors ? new Map(this.#highlightColors.split(",").map((pair) => pair.split("=").map((x) => x.trim()))) : null);
  }
  get highlightColorNames() {
    return shadow(this, "highlightColorNames", this.highlightColors ? new Map(Array.from(this.highlightColors, (e) => e.reverse())) : null);
  }
  setCurrentDrawingSession(layer) {
    if (layer) {
      this.unselectAll();
      this.disableUserSelect(true);
    } else {
      this.disableUserSelect(false);
    }
    this.#currentDrawingSession = layer;
  }
  setMainHighlightColorPicker(colorPicker) {
    this.#mainHighlightColorPicker = colorPicker;
  }
  editAltText(editor, firstTime = false) {
    this.#altTextManager?.editAltText(this, editor, firstTime);
  }
  switchToMode(mode, callback) {
    this._eventBus.on("annotationeditormodechanged", callback, {
      once: true,
      signal: this._signal
    });
    this._eventBus.dispatch("showannotationeditorui", {
      source: this,
      mode
    });
  }
  setPreference(name, value) {
    this._eventBus.dispatch("setpreference", {
      source: this,
      name,
      value
    });
  }
  onSetPreference({
    name,
    value
  }) {
    switch (name) {
      case "enableNewAltTextWhenAddingImage":
        this.#enableNewAltTextWhenAddingImage = value;
        break;
    }
  }
  onPageChanging({
    pageNumber
  }) {
    this.#currentPageIndex = pageNumber - 1;
  }
  focusMainContainer() {
    this.#container.focus();
  }
  findParent(x, y) {
    for (const layer of this.#allLayers.values()) {
      const {
        x: layerX,
        y: layerY,
        width,
        height
      } = layer.div.getBoundingClientRect();
      if (x >= layerX && x <= layerX + width && y >= layerY && y <= layerY + height) {
        return layer;
      }
    }
    return null;
  }
  disableUserSelect(value = false) {
    this.#viewer.classList.toggle("noUserSelect", value);
  }
  addShouldRescale(editor) {
    this.#editorsToRescale.add(editor);
  }
  removeShouldRescale(editor) {
    this.#editorsToRescale.delete(editor);
  }
  onScaleChanging({
    scale
  }) {
    this.commitOrRemove();
    this.viewParameters.realScale = scale * PixelsPerInch.PDF_TO_CSS_UNITS;
    for (const editor of this.#editorsToRescale) {
      editor.onScaleChanging();
    }
    this.#currentDrawingSession?.onScaleChanging();
  }
  onRotationChanging({
    pagesRotation
  }) {
    this.commitOrRemove();
    this.viewParameters.rotation = pagesRotation;
  }
  #getAnchorElementForSelection({
    anchorNode
  }) {
    return anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;
  }
  #getLayerForTextLayer(textLayer) {
    const {
      currentLayer
    } = this;
    if (currentLayer.hasTextLayer(textLayer)) {
      return currentLayer;
    }
    for (const layer of this.#allLayers.values()) {
      if (layer.hasTextLayer(textLayer)) {
        return layer;
      }
    }
    return null;
  }
  highlightSelection(methodOfCreation = "") {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }
    const {
      anchorNode,
      anchorOffset,
      focusNode,
      focusOffset
    } = selection;
    const text = selection.toString();
    const anchorElement = this.#getAnchorElementForSelection(selection);
    const textLayer = anchorElement.closest(".textLayer");
    const boxes = this.getSelectionBoxes(textLayer);
    if (!boxes) {
      return;
    }
    selection.empty();
    const layer = this.#getLayerForTextLayer(textLayer);
    const isNoneMode = this.#mode === AnnotationEditorType.NONE;
    const callback = () => {
      layer?.createAndAddNewEditor({
        x: 0,
        y: 0
      }, false, {
        methodOfCreation,
        boxes,
        anchorNode,
        anchorOffset,
        focusNode,
        focusOffset,
        text
      });
      if (isNoneMode) {
        this.showAllEditors("highlight", true, true);
      }
    };
    if (isNoneMode) {
      this.switchToMode(AnnotationEditorType.HIGHLIGHT, callback);
      return;
    }
    callback();
  }
  #displayHighlightToolbar() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }
    const anchorElement = this.#getAnchorElementForSelection(selection);
    const textLayer = anchorElement.closest(".textLayer");
    const boxes = this.getSelectionBoxes(textLayer);
    if (!boxes) {
      return;
    }
    this.#highlightToolbar ||= new HighlightToolbar(this);
    this.#highlightToolbar.show(textLayer, boxes, this.direction === "ltr");
  }
  addToAnnotationStorage(editor) {
    if (!editor.isEmpty() && this.#annotationStorage && !this.#annotationStorage.has(editor.id)) {
      this.#annotationStorage.setValue(editor.id, editor);
    }
  }
  #selectionChange() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      if (this.#selectedTextNode) {
        this.#highlightToolbar?.hide();
        this.#selectedTextNode = null;
        this.#dispatchUpdateStates({
          hasSelectedText: false
        });
      }
      return;
    }
    const {
      anchorNode
    } = selection;
    if (anchorNode === this.#selectedTextNode) {
      return;
    }
    const anchorElement = this.#getAnchorElementForSelection(selection);
    const textLayer = anchorElement.closest(".textLayer");
    if (!textLayer) {
      if (this.#selectedTextNode) {
        this.#highlightToolbar?.hide();
        this.#selectedTextNode = null;
        this.#dispatchUpdateStates({
          hasSelectedText: false
        });
      }
      return;
    }
    this.#highlightToolbar?.hide();
    this.#selectedTextNode = anchorNode;
    this.#dispatchUpdateStates({
      hasSelectedText: true
    });
    if (this.#mode !== AnnotationEditorType.HIGHLIGHT && this.#mode !== AnnotationEditorType.NONE) {
      return;
    }
    if (this.#mode === AnnotationEditorType.HIGHLIGHT) {
      this.showAllEditors("highlight", true, true);
    }
    this.#highlightWhenShiftUp = this.isShiftKeyDown;
    if (!this.isShiftKeyDown) {
      const activeLayer = this.#mode === AnnotationEditorType.HIGHLIGHT ? this.#getLayerForTextLayer(textLayer) : null;
      activeLayer?.toggleDrawing();
      const ac = new AbortController();
      const signal = this.combinedSignal(ac);
      const pointerup = (e) => {
        if (e.type === "pointerup" && e.button !== 0) {
          return;
        }
        ac.abort();
        activeLayer?.toggleDrawing(true);
        if (e.type === "pointerup") {
          this.#onSelectEnd("main_toolbar");
        }
      };
      window.addEventListener("pointerup", pointerup, {
        signal
      });
      window.addEventListener("blur", pointerup, {
        signal
      });
    }
  }
  #onSelectEnd(methodOfCreation = "") {
    if (this.#mode === AnnotationEditorType.HIGHLIGHT) {
      this.highlightSelection(methodOfCreation);
    } else if (this.#enableHighlightFloatingButton) {
      this.#displayHighlightToolbar();
    }
  }
  #addSelectionListener() {
    document.addEventListener("selectionchange", this.#selectionChange.bind(this), {
      signal: this._signal
    });
  }
  #addFocusManager() {
    if (this.#focusManagerAC) {
      return;
    }
    this.#focusManagerAC = new AbortController();
    const signal = this.combinedSignal(this.#focusManagerAC);
    window.addEventListener("focus", this.focus.bind(this), {
      signal
    });
    window.addEventListener("blur", this.blur.bind(this), {
      signal
    });
  }
  #removeFocusManager() {
    this.#focusManagerAC?.abort();
    this.#focusManagerAC = null;
  }
  blur() {
    this.isShiftKeyDown = false;
    if (this.#highlightWhenShiftUp) {
      this.#highlightWhenShiftUp = false;
      this.#onSelectEnd("main_toolbar");
    }
    if (!this.hasSelection) {
      return;
    }
    const {
      activeElement
    } = document;
    for (const editor of this.#selectedEditors) {
      if (editor.div.contains(activeElement)) {
        this.#lastActiveElement = [editor, activeElement];
        editor._focusEventsAllowed = false;
        break;
      }
    }
  }
  focus() {
    if (!this.#lastActiveElement) {
      return;
    }
    const [lastEditor, lastActiveElement] = this.#lastActiveElement;
    this.#lastActiveElement = null;
    lastActiveElement.addEventListener("focusin", () => {
      lastEditor._focusEventsAllowed = true;
    }, {
      once: true,
      signal: this._signal
    });
    lastActiveElement.focus();
  }
  #addKeyboardManager() {
    if (this.#keyboardManagerAC) {
      return;
    }
    this.#keyboardManagerAC = new AbortController();
    const signal = this.combinedSignal(this.#keyboardManagerAC);
    window.addEventListener("keydown", this.keydown.bind(this), {
      signal
    });
    window.addEventListener("keyup", this.keyup.bind(this), {
      signal
    });
  }
  #removeKeyboardManager() {
    this.#keyboardManagerAC?.abort();
    this.#keyboardManagerAC = null;
  }
  #addCopyPasteListeners() {
    if (this.#copyPasteAC) {
      return;
    }
    this.#copyPasteAC = new AbortController();
    const signal = this.combinedSignal(this.#copyPasteAC);
    document.addEventListener("copy", this.copy.bind(this), {
      signal
    });
    document.addEventListener("cut", this.cut.bind(this), {
      signal
    });
    document.addEventListener("paste", this.paste.bind(this), {
      signal
    });
  }
  #removeCopyPasteListeners() {
    this.#copyPasteAC?.abort();
    this.#copyPasteAC = null;
  }
  #addDragAndDropListeners() {
    const signal = this._signal;
    document.addEventListener("dragover", this.dragOver.bind(this), {
      signal
    });
    document.addEventListener("drop", this.drop.bind(this), {
      signal
    });
  }
  addEditListeners() {
    this.#addKeyboardManager();
    this.#addCopyPasteListeners();
  }
  removeEditListeners() {
    this.#removeKeyboardManager();
    this.#removeCopyPasteListeners();
  }
  dragOver(event) {
    for (const {
      type
    } of event.dataTransfer.items) {
      for (const editorType of this.#editorTypes) {
        if (editorType.isHandlingMimeForPasting(type)) {
          event.dataTransfer.dropEffect = "copy";
          event.preventDefault();
          return;
        }
      }
    }
  }
  drop(event) {
    for (const item of event.dataTransfer.items) {
      for (const editorType of this.#editorTypes) {
        if (editorType.isHandlingMimeForPasting(item.type)) {
          editorType.paste(item, this.currentLayer);
          event.preventDefault();
          return;
        }
      }
    }
  }
  copy(event) {
    event.preventDefault();
    this.#activeEditor?.commitOrRemove();
    if (!this.hasSelection) {
      return;
    }
    const editors = [];
    for (const editor of this.#selectedEditors) {
      const serialized = editor.serialize(true);
      if (serialized) {
        editors.push(serialized);
      }
    }
    if (editors.length === 0) {
      return;
    }
    event.clipboardData.setData("application/pdfjs", JSON.stringify(editors));
  }
  cut(event) {
    this.copy(event);
    this.delete();
  }
  async paste(event) {
    event.preventDefault();
    const {
      clipboardData
    } = event;
    for (const item of clipboardData.items) {
      for (const editorType of this.#editorTypes) {
        if (editorType.isHandlingMimeForPasting(item.type)) {
          editorType.paste(item, this.currentLayer);
          return;
        }
      }
    }
    let data = clipboardData.getData("application/pdfjs");
    if (!data) {
      return;
    }
    try {
      data = JSON.parse(data);
    } catch (ex) {
      warn(`paste: "${ex.message}".`);
      return;
    }
    if (!Array.isArray(data)) {
      return;
    }
    this.unselectAll();
    const layer = this.currentLayer;
    try {
      const newEditors = [];
      for (const editor of data) {
        const deserializedEditor = await layer.deserialize(editor);
        if (!deserializedEditor) {
          return;
        }
        newEditors.push(deserializedEditor);
      }
      const cmd = () => {
        for (const editor of newEditors) {
          this.#addEditorToLayer(editor);
        }
        this.#selectEditors(newEditors);
      };
      const undo = () => {
        for (const editor of newEditors) {
          editor.remove();
        }
      };
      this.addCommands({
        cmd,
        undo,
        mustExec: true
      });
    } catch (ex) {
      warn(`paste: "${ex.message}".`);
    }
  }
  keydown(event) {
    if (!this.isShiftKeyDown && event.key === "Shift") {
      this.isShiftKeyDown = true;
    }
    if (this.#mode !== AnnotationEditorType.NONE && !this.isEditorHandlingKeyboard) {
      _AnnotationEditorUIManager._keyboardManager.exec(this, event);
    }
  }
  keyup(event) {
    if (this.isShiftKeyDown && event.key === "Shift") {
      this.isShiftKeyDown = false;
      if (this.#highlightWhenShiftUp) {
        this.#highlightWhenShiftUp = false;
        this.#onSelectEnd("main_toolbar");
      }
    }
  }
  onEditingAction({
    name
  }) {
    switch (name) {
      case "undo":
      case "redo":
      case "delete":
      case "selectAll":
        this[name]();
        break;
      case "highlightSelection":
        this.highlightSelection("context_menu");
        break;
    }
  }
  #dispatchUpdateStates(details) {
    const hasChanged = Object.entries(details).some(([key, value]) => this.#previousStates[key] !== value);
    if (hasChanged) {
      this._eventBus.dispatch("annotationeditorstateschanged", {
        source: this,
        details: Object.assign(this.#previousStates, details)
      });
      if (this.#mode === AnnotationEditorType.HIGHLIGHT && details.hasSelectedEditor === false) {
        this.#dispatchUpdateUI([[AnnotationEditorParamsType.HIGHLIGHT_FREE, true]]);
      }
    }
  }
  #dispatchUpdateUI(details) {
    this._eventBus.dispatch("annotationeditorparamschanged", {
      source: this,
      details
    });
  }
  setEditingState(isEditing) {
    if (isEditing) {
      this.#addFocusManager();
      this.#addCopyPasteListeners();
      this.#dispatchUpdateStates({
        isEditing: this.#mode !== AnnotationEditorType.NONE,
        isEmpty: this.#isEmpty(),
        hasSomethingToUndo: this.#commandManager.hasSomethingToUndo(),
        hasSomethingToRedo: this.#commandManager.hasSomethingToRedo(),
        hasSelectedEditor: false
      });
    } else {
      this.#removeFocusManager();
      this.#removeCopyPasteListeners();
      this.#dispatchUpdateStates({
        isEditing: false
      });
      this.disableUserSelect(false);
    }
  }
  registerEditorTypes(types) {
    if (this.#editorTypes) {
      return;
    }
    this.#editorTypes = types;
    for (const editorType of this.#editorTypes) {
      this.#dispatchUpdateUI(editorType.defaultPropertiesToUpdate);
    }
  }
  getId() {
    return this.#idManager.id;
  }
  get currentLayer() {
    return this.#allLayers.get(this.#currentPageIndex);
  }
  getLayer(pageIndex) {
    return this.#allLayers.get(pageIndex);
  }
  get currentPageIndex() {
    return this.#currentPageIndex;
  }
  addLayer(layer) {
    this.#allLayers.set(layer.pageIndex, layer);
    if (this.#isEnabled) {
      layer.enable();
    } else {
      layer.disable();
    }
  }
  removeLayer(layer) {
    this.#allLayers.delete(layer.pageIndex);
  }
  async updateMode(mode, editId = null, isFromKeyboard = false) {
    if (this.#mode === mode) {
      return;
    }
    if (this.#updateModeCapability) {
      await this.#updateModeCapability.promise;
      if (!this.#updateModeCapability) {
        return;
      }
    }
    this.#updateModeCapability = Promise.withResolvers();
    this.#mode = mode;
    if (mode === AnnotationEditorType.NONE) {
      this.setEditingState(false);
      this.#disableAll();
      this._editorUndoBar?.hide();
      this.#updateModeCapability.resolve();
      return;
    }
    this.setEditingState(true);
    await this.#enableAll();
    this.unselectAll();
    for (const layer of this.#allLayers.values()) {
      layer.updateMode(mode);
    }
    if (!editId) {
      if (isFromKeyboard) {
        this.addNewEditorFromKeyboard();
      }
      this.#updateModeCapability.resolve();
      return;
    }
    for (const editor of this.#allEditors.values()) {
      if (editor.annotationElementId === editId) {
        this.setSelected(editor);
        editor.enterInEditMode();
      } else {
        editor.unselect();
      }
    }
    this.#updateModeCapability.resolve();
  }
  addNewEditorFromKeyboard() {
    if (this.currentLayer.canCreateNewEmptyEditor()) {
      this.currentLayer.addNewEditor();
    }
  }
  updateToolbar(mode) {
    if (mode === this.#mode) {
      return;
    }
    this._eventBus.dispatch("switchannotationeditormode", {
      source: this,
      mode
    });
  }
  updateParams(type, value) {
    if (!this.#editorTypes) {
      return;
    }
    switch (type) {
      case AnnotationEditorParamsType.CREATE:
        this.currentLayer.addNewEditor();
        return;
      case AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR:
        this.#mainHighlightColorPicker?.updateColor(value);
        break;
      case AnnotationEditorParamsType.HIGHLIGHT_SHOW_ALL:
        this._eventBus.dispatch("reporttelemetry", {
          source: this,
          details: {
            type: "editing",
            data: {
              type: "highlight",
              action: "toggle_visibility"
            }
          }
        });
        (this.#showAllStates ||= /* @__PURE__ */ new Map()).set(type, value);
        this.showAllEditors("highlight", value);
        break;
    }
    for (const editor of this.#selectedEditors) {
      editor.updateParams(type, value);
    }
    for (const editorType of this.#editorTypes) {
      editorType.updateDefaultParams(type, value);
    }
  }
  showAllEditors(type, visible, updateButton = false) {
    for (const editor of this.#allEditors.values()) {
      if (editor.editorType === type) {
        editor.show(visible);
      }
    }
    const state = this.#showAllStates?.get(AnnotationEditorParamsType.HIGHLIGHT_SHOW_ALL) ?? true;
    if (state !== visible) {
      this.#dispatchUpdateUI([[AnnotationEditorParamsType.HIGHLIGHT_SHOW_ALL, visible]]);
    }
  }
  enableWaiting(mustWait = false) {
    if (this.#isWaiting === mustWait) {
      return;
    }
    this.#isWaiting = mustWait;
    for (const layer of this.#allLayers.values()) {
      if (mustWait) {
        layer.disableClick();
      } else {
        layer.enableClick();
      }
      layer.div.classList.toggle("waiting", mustWait);
    }
  }
  async #enableAll() {
    if (!this.#isEnabled) {
      this.#isEnabled = true;
      const promises = [];
      for (const layer of this.#allLayers.values()) {
        promises.push(layer.enable());
      }
      await Promise.all(promises);
      for (const editor of this.#allEditors.values()) {
        editor.enable();
      }
    }
  }
  #disableAll() {
    this.unselectAll();
    if (this.#isEnabled) {
      this.#isEnabled = false;
      for (const layer of this.#allLayers.values()) {
        layer.disable();
      }
      for (const editor of this.#allEditors.values()) {
        editor.disable();
      }
    }
  }
  getEditors(pageIndex) {
    const editors = [];
    for (const editor of this.#allEditors.values()) {
      if (editor.pageIndex === pageIndex) {
        editors.push(editor);
      }
    }
    return editors;
  }
  getEditor(id) {
    return this.#allEditors.get(id);
  }
  addEditor(editor) {
    this.#allEditors.set(editor.id, editor);
  }
  removeEditor(editor) {
    if (editor.div.contains(document.activeElement)) {
      if (this.#focusMainContainerTimeoutId) {
        clearTimeout(this.#focusMainContainerTimeoutId);
      }
      this.#focusMainContainerTimeoutId = setTimeout(() => {
        this.focusMainContainer();
        this.#focusMainContainerTimeoutId = null;
      }, 0);
    }
    this.#allEditors.delete(editor.id);
    this.unselect(editor);
    if (!editor.annotationElementId || !this.#deletedAnnotationsElementIds.has(editor.annotationElementId)) {
      this.#annotationStorage?.remove(editor.id);
    }
  }
  addDeletedAnnotationElement(editor) {
    this.#deletedAnnotationsElementIds.add(editor.annotationElementId);
    this.addChangedExistingAnnotation(editor);
    editor.deleted = true;
  }
  isDeletedAnnotationElement(annotationElementId) {
    return this.#deletedAnnotationsElementIds.has(annotationElementId);
  }
  removeDeletedAnnotationElement(editor) {
    this.#deletedAnnotationsElementIds.delete(editor.annotationElementId);
    this.removeChangedExistingAnnotation(editor);
    editor.deleted = false;
  }
  #addEditorToLayer(editor) {
    const layer = this.#allLayers.get(editor.pageIndex);
    if (layer) {
      layer.addOrRebuild(editor);
    } else {
      this.addEditor(editor);
      this.addToAnnotationStorage(editor);
    }
  }
  setActiveEditor(editor) {
    if (this.#activeEditor === editor) {
      return;
    }
    this.#activeEditor = editor;
    if (editor) {
      this.#dispatchUpdateUI(editor.propertiesToUpdate);
    }
  }
  get #lastSelectedEditor() {
    let ed = null;
    for (ed of this.#selectedEditors) {
    }
    return ed;
  }
  updateUI(editor) {
    if (this.#lastSelectedEditor === editor) {
      this.#dispatchUpdateUI(editor.propertiesToUpdate);
    }
  }
  updateUIForDefaultProperties(editorType) {
    this.#dispatchUpdateUI(editorType.defaultPropertiesToUpdate);
  }
  toggleSelected(editor) {
    if (this.#selectedEditors.has(editor)) {
      this.#selectedEditors.delete(editor);
      editor.unselect();
      this.#dispatchUpdateStates({
        hasSelectedEditor: this.hasSelection
      });
      return;
    }
    this.#selectedEditors.add(editor);
    editor.select();
    this.#dispatchUpdateUI(editor.propertiesToUpdate);
    this.#dispatchUpdateStates({
      hasSelectedEditor: true
    });
  }
  setSelected(editor) {
    this.#currentDrawingSession?.commitOrRemove();
    for (const ed of this.#selectedEditors) {
      if (ed !== editor) {
        ed.unselect();
      }
    }
    this.#selectedEditors.clear();
    this.#selectedEditors.add(editor);
    editor.select();
    this.#dispatchUpdateUI(editor.propertiesToUpdate);
    this.#dispatchUpdateStates({
      hasSelectedEditor: true
    });
  }
  isSelected(editor) {
    return this.#selectedEditors.has(editor);
  }
  get firstSelectedEditor() {
    return this.#selectedEditors.values().next().value;
  }
  unselect(editor) {
    editor.unselect();
    this.#selectedEditors.delete(editor);
    this.#dispatchUpdateStates({
      hasSelectedEditor: this.hasSelection
    });
  }
  get hasSelection() {
    return this.#selectedEditors.size !== 0;
  }
  get isEnterHandled() {
    return this.#selectedEditors.size === 1 && this.firstSelectedEditor.isEnterHandled;
  }
  undo() {
    this.#commandManager.undo();
    this.#dispatchUpdateStates({
      hasSomethingToUndo: this.#commandManager.hasSomethingToUndo(),
      hasSomethingToRedo: true,
      isEmpty: this.#isEmpty()
    });
    this._editorUndoBar?.hide();
  }
  redo() {
    this.#commandManager.redo();
    this.#dispatchUpdateStates({
      hasSomethingToUndo: true,
      hasSomethingToRedo: this.#commandManager.hasSomethingToRedo(),
      isEmpty: this.#isEmpty()
    });
  }
  addCommands(params) {
    this.#commandManager.add(params);
    this.#dispatchUpdateStates({
      hasSomethingToUndo: true,
      hasSomethingToRedo: false,
      isEmpty: this.#isEmpty()
    });
  }
  cleanUndoStack(type) {
    this.#commandManager.cleanType(type);
  }
  #isEmpty() {
    if (this.#allEditors.size === 0) {
      return true;
    }
    if (this.#allEditors.size === 1) {
      for (const editor of this.#allEditors.values()) {
        return editor.isEmpty();
      }
    }
    return false;
  }
  delete() {
    this.commitOrRemove();
    const drawingEditor = this.currentLayer?.endDrawingSession(true);
    if (!this.hasSelection && !drawingEditor) {
      return;
    }
    const editors = drawingEditor ? [drawingEditor] : [...this.#selectedEditors];
    const cmd = () => {
      this._editorUndoBar?.show(undo, editors.length === 1 ? editors[0].editorType : editors.length);
      for (const editor of editors) {
        editor.remove();
      }
    };
    const undo = () => {
      for (const editor of editors) {
        this.#addEditorToLayer(editor);
      }
    };
    this.addCommands({
      cmd,
      undo,
      mustExec: true
    });
  }
  commitOrRemove() {
    this.#activeEditor?.commitOrRemove();
  }
  hasSomethingToControl() {
    return this.#activeEditor || this.hasSelection;
  }
  #selectEditors(editors) {
    for (const editor of this.#selectedEditors) {
      editor.unselect();
    }
    this.#selectedEditors.clear();
    for (const editor of editors) {
      if (editor.isEmpty()) {
        continue;
      }
      this.#selectedEditors.add(editor);
      editor.select();
    }
    this.#dispatchUpdateStates({
      hasSelectedEditor: this.hasSelection
    });
  }
  selectAll() {
    for (const editor of this.#selectedEditors) {
      editor.commit();
    }
    this.#selectEditors(this.#allEditors.values());
  }
  unselectAll() {
    if (this.#activeEditor) {
      this.#activeEditor.commitOrRemove();
      if (this.#mode !== AnnotationEditorType.NONE) {
        return;
      }
    }
    if (this.#currentDrawingSession?.commitOrRemove()) {
      return;
    }
    if (!this.hasSelection) {
      return;
    }
    for (const editor of this.#selectedEditors) {
      editor.unselect();
    }
    this.#selectedEditors.clear();
    this.#dispatchUpdateStates({
      hasSelectedEditor: false
    });
  }
  translateSelectedEditors(x, y, noCommit = false) {
    if (!noCommit) {
      this.commitOrRemove();
    }
    if (!this.hasSelection) {
      return;
    }
    this.#translation[0] += x;
    this.#translation[1] += y;
    const [totalX, totalY] = this.#translation;
    const editors = [...this.#selectedEditors];
    const TIME_TO_WAIT = 1e3;
    if (this.#translationTimeoutId) {
      clearTimeout(this.#translationTimeoutId);
    }
    this.#translationTimeoutId = setTimeout(() => {
      this.#translationTimeoutId = null;
      this.#translation[0] = this.#translation[1] = 0;
      this.addCommands({
        cmd: () => {
          for (const editor of editors) {
            if (this.#allEditors.has(editor.id)) {
              editor.translateInPage(totalX, totalY);
            }
          }
        },
        undo: () => {
          for (const editor of editors) {
            if (this.#allEditors.has(editor.id)) {
              editor.translateInPage(-totalX, -totalY);
            }
          }
        },
        mustExec: false
      });
    }, TIME_TO_WAIT);
    for (const editor of editors) {
      editor.translateInPage(x, y);
    }
  }
  setUpDragSession() {
    if (!this.hasSelection) {
      return;
    }
    this.disableUserSelect(true);
    this.#draggingEditors = /* @__PURE__ */ new Map();
    for (const editor of this.#selectedEditors) {
      this.#draggingEditors.set(editor, {
        savedX: editor.x,
        savedY: editor.y,
        savedPageIndex: editor.pageIndex,
        newX: 0,
        newY: 0,
        newPageIndex: -1
      });
    }
  }
  endDragSession() {
    if (!this.#draggingEditors) {
      return false;
    }
    this.disableUserSelect(false);
    const map = this.#draggingEditors;
    this.#draggingEditors = null;
    let mustBeAddedInUndoStack = false;
    for (const [{
      x,
      y,
      pageIndex
    }, value] of map) {
      value.newX = x;
      value.newY = y;
      value.newPageIndex = pageIndex;
      mustBeAddedInUndoStack ||= x !== value.savedX || y !== value.savedY || pageIndex !== value.savedPageIndex;
    }
    if (!mustBeAddedInUndoStack) {
      return false;
    }
    const move = (editor, x, y, pageIndex) => {
      if (this.#allEditors.has(editor.id)) {
        const parent = this.#allLayers.get(pageIndex);
        if (parent) {
          editor._setParentAndPosition(parent, x, y);
        } else {
          editor.pageIndex = pageIndex;
          editor.x = x;
          editor.y = y;
        }
      }
    };
    this.addCommands({
      cmd: () => {
        for (const [editor, {
          newX,
          newY,
          newPageIndex
        }] of map) {
          move(editor, newX, newY, newPageIndex);
        }
      },
      undo: () => {
        for (const [editor, {
          savedX,
          savedY,
          savedPageIndex
        }] of map) {
          move(editor, savedX, savedY, savedPageIndex);
        }
      },
      mustExec: true
    });
    return true;
  }
  dragSelectedEditors(tx, ty) {
    if (!this.#draggingEditors) {
      return;
    }
    for (const editor of this.#draggingEditors.keys()) {
      editor.drag(tx, ty);
    }
  }
  rebuild(editor) {
    if (editor.parent === null) {
      const parent = this.getLayer(editor.pageIndex);
      if (parent) {
        parent.changeParent(editor);
        parent.addOrRebuild(editor);
      } else {
        this.addEditor(editor);
        this.addToAnnotationStorage(editor);
        editor.rebuild();
      }
    } else {
      editor.parent.addOrRebuild(editor);
    }
  }
  get isEditorHandlingKeyboard() {
    return this.getActive()?.shouldGetKeyboardEvents() || this.#selectedEditors.size === 1 && this.firstSelectedEditor.shouldGetKeyboardEvents();
  }
  isActive(editor) {
    return this.#activeEditor === editor;
  }
  getActive() {
    return this.#activeEditor;
  }
  getMode() {
    return this.#mode;
  }
  get imageManager() {
    return shadow(this, "imageManager", new ImageManager());
  }
  getSelectionBoxes(textLayer) {
    if (!textLayer) {
      return null;
    }
    const selection = document.getSelection();
    for (let i = 0, ii = selection.rangeCount; i < ii; i++) {
      if (!textLayer.contains(selection.getRangeAt(i).commonAncestorContainer)) {
        return null;
      }
    }
    const {
      x: layerX,
      y: layerY,
      width: parentWidth,
      height: parentHeight
    } = textLayer.getBoundingClientRect();
    let rotator;
    switch (textLayer.getAttribute("data-main-rotation")) {
      case "90":
        rotator = (x, y, w, h) => ({
          x: (y - layerY) / parentHeight,
          y: 1 - (x + w - layerX) / parentWidth,
          width: h / parentHeight,
          height: w / parentWidth
        });
        break;
      case "180":
        rotator = (x, y, w, h) => ({
          x: 1 - (x + w - layerX) / parentWidth,
          y: 1 - (y + h - layerY) / parentHeight,
          width: w / parentWidth,
          height: h / parentHeight
        });
        break;
      case "270":
        rotator = (x, y, w, h) => ({
          x: 1 - (y + h - layerY) / parentHeight,
          y: (x - layerX) / parentWidth,
          width: h / parentHeight,
          height: w / parentWidth
        });
        break;
      default:
        rotator = (x, y, w, h) => ({
          x: (x - layerX) / parentWidth,
          y: (y - layerY) / parentHeight,
          width: w / parentWidth,
          height: h / parentHeight
        });
        break;
    }
    const boxes = [];
    for (let i = 0, ii = selection.rangeCount; i < ii; i++) {
      const range = selection.getRangeAt(i);
      if (range.collapsed) {
        continue;
      }
      for (const {
        x,
        y,
        width,
        height
      } of range.getClientRects()) {
        if (width === 0 || height === 0) {
          continue;
        }
        boxes.push(rotator(x, y, width, height));
      }
    }
    return boxes.length === 0 ? null : boxes;
  }
  addChangedExistingAnnotation({
    annotationElementId,
    id
  }) {
    (this.#changedExistingAnnotations ||= /* @__PURE__ */ new Map()).set(annotationElementId, id);
  }
  removeChangedExistingAnnotation({
    annotationElementId
  }) {
    this.#changedExistingAnnotations?.delete(annotationElementId);
  }
  renderAnnotationElement(annotation) {
    const editorId = this.#changedExistingAnnotations?.get(annotation.data.id);
    if (!editorId) {
      return;
    }
    const editor = this.#annotationStorage.getRawValue(editorId);
    if (!editor) {
      return;
    }
    if (this.#mode === AnnotationEditorType.NONE && !editor.hasBeenModified) {
      return;
    }
    editor.renderAnnotationElement(annotation);
  }
};
var AltText = class _AltText {
  #altText = null;
  #altTextDecorative = false;
  #altTextButton = null;
  #altTextButtonLabel = null;
  #altTextTooltip = null;
  #altTextTooltipTimeout = null;
  #altTextWasFromKeyBoard = false;
  #badge = null;
  #editor = null;
  #guessedText = null;
  #textWithDisclaimer = null;
  #useNewAltTextFlow = false;
  static #l10nNewButton = null;
  static _l10n = null;
  constructor(editor) {
    this.#editor = editor;
    this.#useNewAltTextFlow = editor._uiManager.useNewAltTextFlow;
    _AltText.#l10nNewButton ||= Object.freeze({
      added: "pdfjs-editor-new-alt-text-added-button",
      "added-label": "pdfjs-editor-new-alt-text-added-button-label",
      missing: "pdfjs-editor-new-alt-text-missing-button",
      "missing-label": "pdfjs-editor-new-alt-text-missing-button-label",
      review: "pdfjs-editor-new-alt-text-to-review-button",
      "review-label": "pdfjs-editor-new-alt-text-to-review-button-label"
    });
  }
  static initialize(l10n) {
    _AltText._l10n ??= l10n;
  }
  async render() {
    const altText = this.#altTextButton = document.createElement("button");
    altText.className = "altText";
    altText.tabIndex = "0";
    const label = this.#altTextButtonLabel = document.createElement("span");
    altText.append(label);
    if (this.#useNewAltTextFlow) {
      altText.classList.add("new");
      altText.setAttribute("data-l10n-id", _AltText.#l10nNewButton.missing);
      label.setAttribute("data-l10n-id", _AltText.#l10nNewButton["missing-label"]);
    } else {
      altText.setAttribute("data-l10n-id", "pdfjs-editor-alt-text-button");
      label.setAttribute("data-l10n-id", "pdfjs-editor-alt-text-button-label");
    }
    const signal = this.#editor._uiManager._signal;
    altText.addEventListener("contextmenu", noContextMenu, {
      signal
    });
    altText.addEventListener("pointerdown", (event) => event.stopPropagation(), {
      signal
    });
    const onClick = (event) => {
      event.preventDefault();
      this.#editor._uiManager.editAltText(this.#editor);
      if (this.#useNewAltTextFlow) {
        this.#editor._reportTelemetry({
          action: "pdfjs.image.alt_text.image_status_label_clicked",
          data: {
            label: this.#label
          }
        });
      }
    };
    altText.addEventListener("click", onClick, {
      capture: true,
      signal
    });
    altText.addEventListener("keydown", (event) => {
      if (event.target === altText && event.key === "Enter") {
        this.#altTextWasFromKeyBoard = true;
        onClick(event);
      }
    }, {
      signal
    });
    await this.#setState();
    return altText;
  }
  get #label() {
    return this.#altText && "added" || this.#altText === null && this.guessedText && "review" || "missing";
  }
  finish() {
    if (!this.#altTextButton) {
      return;
    }
    this.#altTextButton.focus({
      focusVisible: this.#altTextWasFromKeyBoard
    });
    this.#altTextWasFromKeyBoard = false;
  }
  isEmpty() {
    if (this.#useNewAltTextFlow) {
      return this.#altText === null;
    }
    return !this.#altText && !this.#altTextDecorative;
  }
  hasData() {
    if (this.#useNewAltTextFlow) {
      return this.#altText !== null || !!this.#guessedText;
    }
    return this.isEmpty();
  }
  get guessedText() {
    return this.#guessedText;
  }
  async setGuessedText(guessedText) {
    if (this.#altText !== null) {
      return;
    }
    this.#guessedText = guessedText;
    this.#textWithDisclaimer = await _AltText._l10n.get("pdfjs-editor-new-alt-text-generated-alt-text-with-disclaimer", {
      generatedAltText: guessedText
    });
    this.#setState();
  }
  toggleAltTextBadge(visibility = false) {
    if (!this.#useNewAltTextFlow || this.#altText) {
      this.#badge?.remove();
      this.#badge = null;
      return;
    }
    if (!this.#badge) {
      const badge = this.#badge = document.createElement("div");
      badge.className = "noAltTextBadge";
      this.#editor.div.append(badge);
    }
    this.#badge.classList.toggle("hidden", !visibility);
  }
  serialize(isForCopying) {
    let altText = this.#altText;
    if (!isForCopying && this.#guessedText === altText) {
      altText = this.#textWithDisclaimer;
    }
    return {
      altText,
      decorative: this.#altTextDecorative,
      guessedText: this.#guessedText,
      textWithDisclaimer: this.#textWithDisclaimer
    };
  }
  get data() {
    return {
      altText: this.#altText,
      decorative: this.#altTextDecorative
    };
  }
  set data({
    altText,
    decorative,
    guessedText,
    textWithDisclaimer,
    cancel = false
  }) {
    if (guessedText) {
      this.#guessedText = guessedText;
      this.#textWithDisclaimer = textWithDisclaimer;
    }
    if (this.#altText === altText && this.#altTextDecorative === decorative) {
      return;
    }
    if (!cancel) {
      this.#altText = altText;
      this.#altTextDecorative = decorative;
    }
    this.#setState();
  }
  toggle(enabled = false) {
    if (!this.#altTextButton) {
      return;
    }
    if (!enabled && this.#altTextTooltipTimeout) {
      clearTimeout(this.#altTextTooltipTimeout);
      this.#altTextTooltipTimeout = null;
    }
    this.#altTextButton.disabled = !enabled;
  }
  shown() {
    this.#editor._reportTelemetry({
      action: "pdfjs.image.alt_text.image_status_label_displayed",
      data: {
        label: this.#label
      }
    });
  }
  destroy() {
    this.#altTextButton?.remove();
    this.#altTextButton = null;
    this.#altTextButtonLabel = null;
    this.#altTextTooltip = null;
    this.#badge?.remove();
    this.#badge = null;
  }
  async #setState() {
    const button = this.#altTextButton;
    if (!button) {
      return;
    }
    if (this.#useNewAltTextFlow) {
      button.classList.toggle("done", !!this.#altText);
      button.setAttribute("data-l10n-id", _AltText.#l10nNewButton[this.#label]);
      this.#altTextButtonLabel?.setAttribute("data-l10n-id", _AltText.#l10nNewButton[`${this.#label}-label`]);
      if (!this.#altText) {
        this.#altTextTooltip?.remove();
        return;
      }
    } else {
      if (!this.#altText && !this.#altTextDecorative) {
        button.classList.remove("done");
        this.#altTextTooltip?.remove();
        return;
      }
      button.classList.add("done");
      button.setAttribute("data-l10n-id", "pdfjs-editor-alt-text-edit-button");
    }
    let tooltip = this.#altTextTooltip;
    if (!tooltip) {
      this.#altTextTooltip = tooltip = document.createElement("span");
      tooltip.className = "tooltip";
      tooltip.setAttribute("role", "tooltip");
      tooltip.id = `alt-text-tooltip-${this.#editor.id}`;
      const DELAY_TO_SHOW_TOOLTIP = 100;
      const signal = this.#editor._uiManager._signal;
      signal.addEventListener("abort", () => {
        clearTimeout(this.#altTextTooltipTimeout);
        this.#altTextTooltipTimeout = null;
      }, {
        once: true
      });
      button.addEventListener("mouseenter", () => {
        this.#altTextTooltipTimeout = setTimeout(() => {
          this.#altTextTooltipTimeout = null;
          this.#altTextTooltip.classList.add("show");
          this.#editor._reportTelemetry({
            action: "alt_text_tooltip"
          });
        }, DELAY_TO_SHOW_TOOLTIP);
      }, {
        signal
      });
      button.addEventListener("mouseleave", () => {
        if (this.#altTextTooltipTimeout) {
          clearTimeout(this.#altTextTooltipTimeout);
          this.#altTextTooltipTimeout = null;
        }
        this.#altTextTooltip?.classList.remove("show");
      }, {
        signal
      });
    }
    if (this.#altTextDecorative) {
      tooltip.setAttribute("data-l10n-id", "pdfjs-editor-alt-text-decorative-tooltip");
    } else {
      tooltip.removeAttribute("data-l10n-id");
      tooltip.textContent = this.#altText;
    }
    if (!tooltip.parentNode) {
      button.append(tooltip);
    }
    const element = this.#editor.getImageForAltText();
    element?.setAttribute("aria-describedby", tooltip.id);
  }
};
var TouchManager = class _TouchManager {
  #container;
  #isPinching = false;
  #isPinchingStopped = null;
  #isPinchingDisabled;
  #onPinchStart;
  #onPinching;
  #onPinchEnd;
  #signal;
  #touchInfo = null;
  #touchManagerAC;
  #touchMoveAC = null;
  constructor({
    container,
    isPinchingDisabled = null,
    isPinchingStopped = null,
    onPinchStart = null,
    onPinching = null,
    onPinchEnd = null,
    signal
  }) {
    this.#container = container;
    this.#isPinchingStopped = isPinchingStopped;
    this.#isPinchingDisabled = isPinchingDisabled;
    this.#onPinchStart = onPinchStart;
    this.#onPinching = onPinching;
    this.#onPinchEnd = onPinchEnd;
    this.#touchManagerAC = new AbortController();
    this.#signal = AbortSignal.any([signal, this.#touchManagerAC.signal]);
    container.addEventListener("touchstart", this.#onTouchStart.bind(this), {
      passive: false,
      signal: this.#signal
    });
  }
  get MIN_TOUCH_DISTANCE_TO_PINCH() {
    return shadow(this, "MIN_TOUCH_DISTANCE_TO_PINCH", 35 / (window.devicePixelRatio || 1));
  }
  #onTouchStart(evt) {
    if (this.#isPinchingDisabled?.() || evt.touches.length < 2) {
      return;
    }
    if (!this.#touchMoveAC) {
      this.#touchMoveAC = new AbortController();
      const signal = AbortSignal.any([this.#signal, this.#touchMoveAC.signal]);
      const container = this.#container;
      const opt = {
        signal,
        passive: false
      };
      container.addEventListener("touchmove", this.#onTouchMove.bind(this), opt);
      container.addEventListener("touchend", this.#onTouchEnd.bind(this), opt);
      container.addEventListener("touchcancel", this.#onTouchEnd.bind(this), opt);
      this.#onPinchStart?.();
    }
    stopEvent(evt);
    if (evt.touches.length !== 2 || this.#isPinchingStopped?.()) {
      this.#touchInfo = null;
      return;
    }
    let [touch0, touch1] = evt.touches;
    if (touch0.identifier > touch1.identifier) {
      [touch0, touch1] = [touch1, touch0];
    }
    this.#touchInfo = {
      touch0X: touch0.screenX,
      touch0Y: touch0.screenY,
      touch1X: touch1.screenX,
      touch1Y: touch1.screenY
    };
  }
  #onTouchMove(evt) {
    if (!this.#touchInfo || evt.touches.length !== 2) {
      return;
    }
    let [touch0, touch1] = evt.touches;
    if (touch0.identifier > touch1.identifier) {
      [touch0, touch1] = [touch1, touch0];
    }
    const {
      screenX: screen0X,
      screenY: screen0Y
    } = touch0;
    const {
      screenX: screen1X,
      screenY: screen1Y
    } = touch1;
    const touchInfo = this.#touchInfo;
    const {
      touch0X: pTouch0X,
      touch0Y: pTouch0Y,
      touch1X: pTouch1X,
      touch1Y: pTouch1Y
    } = touchInfo;
    const prevGapX = pTouch1X - pTouch0X;
    const prevGapY = pTouch1Y - pTouch0Y;
    const currGapX = screen1X - screen0X;
    const currGapY = screen1Y - screen0Y;
    const distance = Math.hypot(currGapX, currGapY) || 1;
    const pDistance = Math.hypot(prevGapX, prevGapY) || 1;
    if (!this.#isPinching && Math.abs(pDistance - distance) <= _TouchManager.MIN_TOUCH_DISTANCE_TO_PINCH) {
      return;
    }
    touchInfo.touch0X = screen0X;
    touchInfo.touch0Y = screen0Y;
    touchInfo.touch1X = screen1X;
    touchInfo.touch1Y = screen1Y;
    evt.preventDefault();
    if (!this.#isPinching) {
      this.#isPinching = true;
      return;
    }
    const origin = [(screen0X + screen1X) / 2, (screen0Y + screen1Y) / 2];
    this.#onPinching?.(origin, pDistance, distance);
  }
  #onTouchEnd(evt) {
    this.#touchMoveAC.abort();
    this.#touchMoveAC = null;
    this.#onPinchEnd?.();
    if (!this.#touchInfo) {
      return;
    }
    evt.preventDefault();
    this.#touchInfo = null;
    this.#isPinching = false;
  }
  destroy() {
    this.#touchManagerAC?.abort();
    this.#touchManagerAC = null;
  }
};
var AnnotationEditor = class _AnnotationEditor {
  #accessibilityData = null;
  #allResizerDivs = null;
  #altText = null;
  #disabled = false;
  #dragPointerId = null;
  #dragPointerType = "";
  #keepAspectRatio = false;
  #resizersDiv = null;
  #lastPointerCoords = null;
  #savedDimensions = null;
  #focusAC = null;
  #focusedResizerName = "";
  #hasBeenClicked = false;
  #initialRect = null;
  #isEditing = false;
  #isInEditMode = false;
  #isResizerEnabledForKeyboard = false;
  #moveInDOMTimeout = null;
  #prevDragX = 0;
  #prevDragY = 0;
  #telemetryTimeouts = null;
  #touchManager = null;
  _editToolbar = null;
  _initialOptions = /* @__PURE__ */ Object.create(null);
  _initialData = null;
  _isVisible = true;
  _uiManager = null;
  _focusEventsAllowed = true;
  static _l10n = null;
  static _l10nResizer = null;
  #isDraggable = false;
  #zIndex = _AnnotationEditor._zIndex++;
  static _borderLineWidth = -1;
  static _colorManager = new ColorManager();
  static _zIndex = 1;
  static _telemetryTimeout = 1e3;
  static get _resizerKeyboardManager() {
    const resize = _AnnotationEditor.prototype._resizeWithKeyboard;
    const small = AnnotationEditorUIManager.TRANSLATE_SMALL;
    const big = AnnotationEditorUIManager.TRANSLATE_BIG;
    return shadow(this, "_resizerKeyboardManager", new KeyboardManager([[["ArrowLeft", "mac+ArrowLeft"], resize, {
      args: [-small, 0]
    }], [["ctrl+ArrowLeft", "mac+shift+ArrowLeft"], resize, {
      args: [-big, 0]
    }], [["ArrowRight", "mac+ArrowRight"], resize, {
      args: [small, 0]
    }], [["ctrl+ArrowRight", "mac+shift+ArrowRight"], resize, {
      args: [big, 0]
    }], [["ArrowUp", "mac+ArrowUp"], resize, {
      args: [0, -small]
    }], [["ctrl+ArrowUp", "mac+shift+ArrowUp"], resize, {
      args: [0, -big]
    }], [["ArrowDown", "mac+ArrowDown"], resize, {
      args: [0, small]
    }], [["ctrl+ArrowDown", "mac+shift+ArrowDown"], resize, {
      args: [0, big]
    }], [["Escape", "mac+Escape"], _AnnotationEditor.prototype._stopResizingWithKeyboard]]));
  }
  constructor(parameters) {
    this.parent = parameters.parent;
    this.id = parameters.id;
    this.width = this.height = null;
    this.pageIndex = parameters.parent.pageIndex;
    this.name = parameters.name;
    this.div = null;
    this._uiManager = parameters.uiManager;
    this.annotationElementId = null;
    this._willKeepAspectRatio = false;
    this._initialOptions.isCentered = parameters.isCentered;
    this._structTreeParentId = null;
    const {
      rotation,
      rawDims: {
        pageWidth,
        pageHeight,
        pageX,
        pageY
      }
    } = this.parent.viewport;
    this.rotation = rotation;
    this.pageRotation = (360 + rotation - this._uiManager.viewParameters.rotation) % 360;
    this.pageDimensions = [pageWidth, pageHeight];
    this.pageTranslation = [pageX, pageY];
    const [width, height] = this.parentDimensions;
    this.x = parameters.x / width;
    this.y = parameters.y / height;
    this.isAttachedToDOM = false;
    this.deleted = false;
  }
  get editorType() {
    return Object.getPrototypeOf(this).constructor._type;
  }
  static get isDrawer() {
    return false;
  }
  static get _defaultLineColor() {
    return shadow(this, "_defaultLineColor", this._colorManager.getHexCode("CanvasText"));
  }
  static deleteAnnotationElement(editor) {
    const fakeEditor = new FakeEditor({
      id: editor.parent.getNextId(),
      parent: editor.parent,
      uiManager: editor._uiManager
    });
    fakeEditor.annotationElementId = editor.annotationElementId;
    fakeEditor.deleted = true;
    fakeEditor._uiManager.addToAnnotationStorage(fakeEditor);
  }
  static initialize(l10n, _uiManager) {
    _AnnotationEditor._l10n ??= l10n;
    _AnnotationEditor._l10nResizer ||= Object.freeze({
      topLeft: "pdfjs-editor-resizer-top-left",
      topMiddle: "pdfjs-editor-resizer-top-middle",
      topRight: "pdfjs-editor-resizer-top-right",
      middleRight: "pdfjs-editor-resizer-middle-right",
      bottomRight: "pdfjs-editor-resizer-bottom-right",
      bottomMiddle: "pdfjs-editor-resizer-bottom-middle",
      bottomLeft: "pdfjs-editor-resizer-bottom-left",
      middleLeft: "pdfjs-editor-resizer-middle-left"
    });
    if (_AnnotationEditor._borderLineWidth !== -1) {
      return;
    }
    const style = getComputedStyle(document.documentElement);
    _AnnotationEditor._borderLineWidth = parseFloat(style.getPropertyValue("--outline-width")) || 0;
  }
  static updateDefaultParams(_type, _value) {
  }
  static get defaultPropertiesToUpdate() {
    return [];
  }
  static isHandlingMimeForPasting(mime) {
    return false;
  }
  static paste(item, parent) {
    unreachable("Not implemented");
  }
  get propertiesToUpdate() {
    return [];
  }
  get _isDraggable() {
    return this.#isDraggable;
  }
  set _isDraggable(value) {
    this.#isDraggable = value;
    this.div?.classList.toggle("draggable", value);
  }
  get isEnterHandled() {
    return true;
  }
  center() {
    const [pageWidth, pageHeight] = this.pageDimensions;
    switch (this.parentRotation) {
      case 90:
        this.x -= this.height * pageHeight / (pageWidth * 2);
        this.y += this.width * pageWidth / (pageHeight * 2);
        break;
      case 180:
        this.x += this.width / 2;
        this.y += this.height / 2;
        break;
      case 270:
        this.x += this.height * pageHeight / (pageWidth * 2);
        this.y -= this.width * pageWidth / (pageHeight * 2);
        break;
      default:
        this.x -= this.width / 2;
        this.y -= this.height / 2;
        break;
    }
    this.fixAndSetPosition();
  }
  addCommands(params) {
    this._uiManager.addCommands(params);
  }
  get currentLayer() {
    return this._uiManager.currentLayer;
  }
  setInBackground() {
    this.div.style.zIndex = 0;
  }
  setInForeground() {
    this.div.style.zIndex = this.#zIndex;
  }
  setParent(parent) {
    if (parent !== null) {
      this.pageIndex = parent.pageIndex;
      this.pageDimensions = parent.pageDimensions;
    } else {
      this.#stopResizing();
    }
    this.parent = parent;
  }
  focusin(event) {
    if (!this._focusEventsAllowed) {
      return;
    }
    if (!this.#hasBeenClicked) {
      this.parent.setSelected(this);
    } else {
      this.#hasBeenClicked = false;
    }
  }
  focusout(event) {
    if (!this._focusEventsAllowed) {
      return;
    }
    if (!this.isAttachedToDOM) {
      return;
    }
    const target = event.relatedTarget;
    if (target?.closest(`#${this.id}`)) {
      return;
    }
    event.preventDefault();
    if (!this.parent?.isMultipleSelection) {
      this.commitOrRemove();
    }
  }
  commitOrRemove() {
    if (this.isEmpty()) {
      this.remove();
    } else {
      this.commit();
    }
  }
  commit() {
    this.addToAnnotationStorage();
  }
  addToAnnotationStorage() {
    this._uiManager.addToAnnotationStorage(this);
  }
  setAt(x, y, tx, ty) {
    const [width, height] = this.parentDimensions;
    [tx, ty] = this.screenToPageTranslation(tx, ty);
    this.x = (x + tx) / width;
    this.y = (y + ty) / height;
    this.fixAndSetPosition();
  }
  #translate([width, height], x, y) {
    [x, y] = this.screenToPageTranslation(x, y);
    this.x += x / width;
    this.y += y / height;
    this._onTranslating(this.x, this.y);
    this.fixAndSetPosition();
  }
  translate(x, y) {
    this.#translate(this.parentDimensions, x, y);
  }
  translateInPage(x, y) {
    this.#initialRect ||= [this.x, this.y, this.width, this.height];
    this.#translate(this.pageDimensions, x, y);
    this.div.scrollIntoView({
      block: "nearest"
    });
  }
  drag(tx, ty) {
    this.#initialRect ||= [this.x, this.y, this.width, this.height];
    const {
      div,
      parentDimensions: [parentWidth, parentHeight]
    } = this;
    this.x += tx / parentWidth;
    this.y += ty / parentHeight;
    if (this.parent && (this.x < 0 || this.x > 1 || this.y < 0 || this.y > 1)) {
      const {
        x: x2,
        y: y2
      } = this.div.getBoundingClientRect();
      if (this.parent.findNewParent(this, x2, y2)) {
        this.x -= Math.floor(this.x);
        this.y -= Math.floor(this.y);
      }
    }
    let {
      x,
      y
    } = this;
    const [bx, by] = this.getBaseTranslation();
    x += bx;
    y += by;
    const {
      style
    } = div;
    style.left = `${(100 * x).toFixed(2)}%`;
    style.top = `${(100 * y).toFixed(2)}%`;
    this._onTranslating(x, y);
    div.scrollIntoView({
      block: "nearest"
    });
  }
  _onTranslating(x, y) {
  }
  _onTranslated(x, y) {
  }
  get _hasBeenMoved() {
    return !!this.#initialRect && (this.#initialRect[0] !== this.x || this.#initialRect[1] !== this.y);
  }
  get _hasBeenResized() {
    return !!this.#initialRect && (this.#initialRect[2] !== this.width || this.#initialRect[3] !== this.height);
  }
  getBaseTranslation() {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const {
      _borderLineWidth
    } = _AnnotationEditor;
    const x = _borderLineWidth / parentWidth;
    const y = _borderLineWidth / parentHeight;
    switch (this.rotation) {
      case 90:
        return [-x, y];
      case 180:
        return [x, y];
      case 270:
        return [x, -y];
      default:
        return [-x, -y];
    }
  }
  get _mustFixPosition() {
    return true;
  }
  fixAndSetPosition(rotation = this.rotation) {
    const {
      div: {
        style
      },
      pageDimensions: [pageWidth, pageHeight]
    } = this;
    let {
      x,
      y,
      width,
      height
    } = this;
    width *= pageWidth;
    height *= pageHeight;
    x *= pageWidth;
    y *= pageHeight;
    if (this._mustFixPosition) {
      switch (rotation) {
        case 0:
          x = Math.max(0, Math.min(pageWidth - width, x));
          y = Math.max(0, Math.min(pageHeight - height, y));
          break;
        case 90:
          x = Math.max(0, Math.min(pageWidth - height, x));
          y = Math.min(pageHeight, Math.max(width, y));
          break;
        case 180:
          x = Math.min(pageWidth, Math.max(width, x));
          y = Math.min(pageHeight, Math.max(height, y));
          break;
        case 270:
          x = Math.min(pageWidth, Math.max(height, x));
          y = Math.max(0, Math.min(pageHeight - width, y));
          break;
      }
    }
    this.x = x /= pageWidth;
    this.y = y /= pageHeight;
    const [bx, by] = this.getBaseTranslation();
    x += bx;
    y += by;
    style.left = `${(100 * x).toFixed(2)}%`;
    style.top = `${(100 * y).toFixed(2)}%`;
    this.moveInDOM();
  }
  static #rotatePoint(x, y, angle) {
    switch (angle) {
      case 90:
        return [y, -x];
      case 180:
        return [-x, -y];
      case 270:
        return [-y, x];
      default:
        return [x, y];
    }
  }
  screenToPageTranslation(x, y) {
    return _AnnotationEditor.#rotatePoint(x, y, this.parentRotation);
  }
  pageTranslationToScreen(x, y) {
    return _AnnotationEditor.#rotatePoint(x, y, 360 - this.parentRotation);
  }
  #getRotationMatrix(rotation) {
    switch (rotation) {
      case 90: {
        const [pageWidth, pageHeight] = this.pageDimensions;
        return [0, -pageWidth / pageHeight, pageHeight / pageWidth, 0];
      }
      case 180:
        return [-1, 0, 0, -1];
      case 270: {
        const [pageWidth, pageHeight] = this.pageDimensions;
        return [0, pageWidth / pageHeight, -pageHeight / pageWidth, 0];
      }
      default:
        return [1, 0, 0, 1];
    }
  }
  get parentScale() {
    return this._uiManager.viewParameters.realScale;
  }
  get parentRotation() {
    return (this._uiManager.viewParameters.rotation + this.pageRotation) % 360;
  }
  get parentDimensions() {
    const {
      parentScale,
      pageDimensions: [pageWidth, pageHeight]
    } = this;
    return [pageWidth * parentScale, pageHeight * parentScale];
  }
  setDims(width, height) {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const {
      style
    } = this.div;
    style.width = `${(100 * width / parentWidth).toFixed(2)}%`;
    if (!this.#keepAspectRatio) {
      style.height = `${(100 * height / parentHeight).toFixed(2)}%`;
    }
  }
  fixDims() {
    const {
      style
    } = this.div;
    const {
      height,
      width
    } = style;
    const widthPercent = width.endsWith("%");
    const heightPercent = !this.#keepAspectRatio && height.endsWith("%");
    if (widthPercent && heightPercent) {
      return;
    }
    const [parentWidth, parentHeight] = this.parentDimensions;
    if (!widthPercent) {
      style.width = `${(100 * parseFloat(width) / parentWidth).toFixed(2)}%`;
    }
    if (!this.#keepAspectRatio && !heightPercent) {
      style.height = `${(100 * parseFloat(height) / parentHeight).toFixed(2)}%`;
    }
  }
  getInitialTranslation() {
    return [0, 0];
  }
  #createResizers() {
    if (this.#resizersDiv) {
      return;
    }
    this.#resizersDiv = document.createElement("div");
    this.#resizersDiv.classList.add("resizers");
    const classes = this._willKeepAspectRatio ? ["topLeft", "topRight", "bottomRight", "bottomLeft"] : ["topLeft", "topMiddle", "topRight", "middleRight", "bottomRight", "bottomMiddle", "bottomLeft", "middleLeft"];
    const signal = this._uiManager._signal;
    for (const name of classes) {
      const div = document.createElement("div");
      this.#resizersDiv.append(div);
      div.classList.add("resizer", name);
      div.setAttribute("data-resizer-name", name);
      div.addEventListener("pointerdown", this.#resizerPointerdown.bind(this, name), {
        signal
      });
      div.addEventListener("contextmenu", noContextMenu, {
        signal
      });
      div.tabIndex = -1;
    }
    this.div.prepend(this.#resizersDiv);
  }
  #resizerPointerdown(name, event) {
    event.preventDefault();
    const {
      isMac
    } = util_FeatureTest.platform;
    if (event.button !== 0 || event.ctrlKey && isMac) {
      return;
    }
    this.#altText?.toggle(false);
    const savedDraggable = this._isDraggable;
    this._isDraggable = false;
    this.#lastPointerCoords = [event.screenX, event.screenY];
    const ac = new AbortController();
    const signal = this._uiManager.combinedSignal(ac);
    this.parent.togglePointerEvents(false);
    window.addEventListener("pointermove", this.#resizerPointermove.bind(this, name), {
      passive: true,
      capture: true,
      signal
    });
    window.addEventListener("touchmove", stopEvent, {
      passive: false,
      signal
    });
    window.addEventListener("contextmenu", noContextMenu, {
      signal
    });
    this.#savedDimensions = {
      savedX: this.x,
      savedY: this.y,
      savedWidth: this.width,
      savedHeight: this.height
    };
    const savedParentCursor = this.parent.div.style.cursor;
    const savedCursor = this.div.style.cursor;
    this.div.style.cursor = this.parent.div.style.cursor = window.getComputedStyle(event.target).cursor;
    const pointerUpCallback = () => {
      ac.abort();
      this.parent.togglePointerEvents(true);
      this.#altText?.toggle(true);
      this._isDraggable = savedDraggable;
      this.parent.div.style.cursor = savedParentCursor;
      this.div.style.cursor = savedCursor;
      this.#addResizeToUndoStack();
    };
    window.addEventListener("pointerup", pointerUpCallback, {
      signal
    });
    window.addEventListener("blur", pointerUpCallback, {
      signal
    });
  }
  #resize(x, y, width, height) {
    this.width = width;
    this.height = height;
    this.x = x;
    this.y = y;
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(parentWidth * width, parentHeight * height);
    this.fixAndSetPosition();
    this._onResized();
  }
  _onResized() {
  }
  #addResizeToUndoStack() {
    if (!this.#savedDimensions) {
      return;
    }
    const {
      savedX,
      savedY,
      savedWidth,
      savedHeight
    } = this.#savedDimensions;
    this.#savedDimensions = null;
    const newX = this.x;
    const newY = this.y;
    const newWidth = this.width;
    const newHeight = this.height;
    if (newX === savedX && newY === savedY && newWidth === savedWidth && newHeight === savedHeight) {
      return;
    }
    this.addCommands({
      cmd: this.#resize.bind(this, newX, newY, newWidth, newHeight),
      undo: this.#resize.bind(this, savedX, savedY, savedWidth, savedHeight),
      mustExec: true
    });
  }
  static _round(x) {
    return Math.round(x * 1e4) / 1e4;
  }
  #resizerPointermove(name, event) {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const savedX = this.x;
    const savedY = this.y;
    const savedWidth = this.width;
    const savedHeight = this.height;
    const minWidth = _AnnotationEditor.MIN_SIZE / parentWidth;
    const minHeight = _AnnotationEditor.MIN_SIZE / parentHeight;
    const rotationMatrix = this.#getRotationMatrix(this.rotation);
    const transf = (x, y) => [rotationMatrix[0] * x + rotationMatrix[2] * y, rotationMatrix[1] * x + rotationMatrix[3] * y];
    const invRotationMatrix = this.#getRotationMatrix(360 - this.rotation);
    const invTransf = (x, y) => [invRotationMatrix[0] * x + invRotationMatrix[2] * y, invRotationMatrix[1] * x + invRotationMatrix[3] * y];
    let getPoint;
    let getOpposite;
    let isDiagonal = false;
    let isHorizontal = false;
    switch (name) {
      case "topLeft":
        isDiagonal = true;
        getPoint = (w, h) => [0, 0];
        getOpposite = (w, h) => [w, h];
        break;
      case "topMiddle":
        getPoint = (w, h) => [w / 2, 0];
        getOpposite = (w, h) => [w / 2, h];
        break;
      case "topRight":
        isDiagonal = true;
        getPoint = (w, h) => [w, 0];
        getOpposite = (w, h) => [0, h];
        break;
      case "middleRight":
        isHorizontal = true;
        getPoint = (w, h) => [w, h / 2];
        getOpposite = (w, h) => [0, h / 2];
        break;
      case "bottomRight":
        isDiagonal = true;
        getPoint = (w, h) => [w, h];
        getOpposite = (w, h) => [0, 0];
        break;
      case "bottomMiddle":
        getPoint = (w, h) => [w / 2, h];
        getOpposite = (w, h) => [w / 2, 0];
        break;
      case "bottomLeft":
        isDiagonal = true;
        getPoint = (w, h) => [0, h];
        getOpposite = (w, h) => [w, 0];
        break;
      case "middleLeft":
        isHorizontal = true;
        getPoint = (w, h) => [0, h / 2];
        getOpposite = (w, h) => [w, h / 2];
        break;
    }
    const point = getPoint(savedWidth, savedHeight);
    const oppositePoint = getOpposite(savedWidth, savedHeight);
    let transfOppositePoint = transf(...oppositePoint);
    const oppositeX = _AnnotationEditor._round(savedX + transfOppositePoint[0]);
    const oppositeY = _AnnotationEditor._round(savedY + transfOppositePoint[1]);
    let ratioX = 1;
    let ratioY = 1;
    let deltaX, deltaY;
    if (!event.fromKeyboard) {
      const {
        screenX,
        screenY
      } = event;
      const [lastScreenX, lastScreenY] = this.#lastPointerCoords;
      [deltaX, deltaY] = this.screenToPageTranslation(screenX - lastScreenX, screenY - lastScreenY);
      this.#lastPointerCoords[0] = screenX;
      this.#lastPointerCoords[1] = screenY;
    } else {
      ({
        deltaX,
        deltaY
      } = event);
    }
    [deltaX, deltaY] = invTransf(deltaX / parentWidth, deltaY / parentHeight);
    if (isDiagonal) {
      const oldDiag = Math.hypot(savedWidth, savedHeight);
      ratioX = ratioY = Math.max(Math.min(Math.hypot(oppositePoint[0] - point[0] - deltaX, oppositePoint[1] - point[1] - deltaY) / oldDiag, 1 / savedWidth, 1 / savedHeight), minWidth / savedWidth, minHeight / savedHeight);
    } else if (isHorizontal) {
      ratioX = Math.max(minWidth, Math.min(1, Math.abs(oppositePoint[0] - point[0] - deltaX))) / savedWidth;
    } else {
      ratioY = Math.max(minHeight, Math.min(1, Math.abs(oppositePoint[1] - point[1] - deltaY))) / savedHeight;
    }
    const newWidth = _AnnotationEditor._round(savedWidth * ratioX);
    const newHeight = _AnnotationEditor._round(savedHeight * ratioY);
    transfOppositePoint = transf(...getOpposite(newWidth, newHeight));
    const newX = oppositeX - transfOppositePoint[0];
    const newY = oppositeY - transfOppositePoint[1];
    this.#initialRect ||= [this.x, this.y, this.width, this.height];
    this.width = newWidth;
    this.height = newHeight;
    this.x = newX;
    this.y = newY;
    this.setDims(parentWidth * newWidth, parentHeight * newHeight);
    this.fixAndSetPosition();
    this._onResizing();
  }
  _onResizing() {
  }
  altTextFinish() {
    this.#altText?.finish();
  }
  async addEditToolbar() {
    if (this._editToolbar || this.#isInEditMode) {
      return this._editToolbar;
    }
    this._editToolbar = new EditorToolbar(this);
    this.div.append(this._editToolbar.render());
    if (this.#altText) {
      await this._editToolbar.addAltText(this.#altText);
    }
    return this._editToolbar;
  }
  removeEditToolbar() {
    if (!this._editToolbar) {
      return;
    }
    this._editToolbar.remove();
    this._editToolbar = null;
    this.#altText?.destroy();
  }
  addContainer(container) {
    const editToolbarDiv = this._editToolbar?.div;
    if (editToolbarDiv) {
      editToolbarDiv.before(container);
    } else {
      this.div.append(container);
    }
  }
  getClientDimensions() {
    return this.div.getBoundingClientRect();
  }
  async addAltTextButton() {
    if (this.#altText) {
      return;
    }
    AltText.initialize(_AnnotationEditor._l10n);
    this.#altText = new AltText(this);
    if (this.#accessibilityData) {
      this.#altText.data = this.#accessibilityData;
      this.#accessibilityData = null;
    }
    await this.addEditToolbar();
  }
  get altTextData() {
    return this.#altText?.data;
  }
  set altTextData(data) {
    if (!this.#altText) {
      return;
    }
    this.#altText.data = data;
  }
  get guessedAltText() {
    return this.#altText?.guessedText;
  }
  async setGuessedAltText(text) {
    await this.#altText?.setGuessedText(text);
  }
  serializeAltText(isForCopying) {
    return this.#altText?.serialize(isForCopying);
  }
  hasAltText() {
    return !!this.#altText && !this.#altText.isEmpty();
  }
  hasAltTextData() {
    return this.#altText?.hasData() ?? false;
  }
  render() {
    this.div = document.createElement("div");
    this.div.setAttribute("data-editor-rotation", (360 - this.rotation) % 360);
    this.div.className = this.name;
    this.div.setAttribute("id", this.id);
    this.div.tabIndex = this.#disabled ? -1 : 0;
    if (!this._isVisible) {
      this.div.classList.add("hidden");
    }
    this.setInForeground();
    this.#addFocusListeners();
    const [parentWidth, parentHeight] = this.parentDimensions;
    if (this.parentRotation % 180 !== 0) {
      this.div.style.maxWidth = `${(100 * parentHeight / parentWidth).toFixed(2)}%`;
      this.div.style.maxHeight = `${(100 * parentWidth / parentHeight).toFixed(2)}%`;
    }
    const [tx, ty] = this.getInitialTranslation();
    this.translate(tx, ty);
    bindEvents(this, this.div, ["pointerdown"]);
    if (this.isResizable && this._uiManager._supportsPinchToZoom) {
      this.#touchManager ||= new TouchManager({
        container: this.div,
        isPinchingDisabled: () => !this.isSelected,
        onPinchStart: this.#touchPinchStartCallback.bind(this),
        onPinching: this.#touchPinchCallback.bind(this),
        onPinchEnd: this.#touchPinchEndCallback.bind(this),
        signal: this._uiManager._signal
      });
    }
    this._uiManager._editorUndoBar?.hide();
    return this.div;
  }
  #touchPinchStartCallback() {
    this.#savedDimensions = {
      savedX: this.x,
      savedY: this.y,
      savedWidth: this.width,
      savedHeight: this.height
    };
    this.#altText?.toggle(false);
    this.parent.togglePointerEvents(false);
  }
  #touchPinchCallback(_origin, prevDistance, distance) {
    const slowDownFactor = 0.7;
    let factor = slowDownFactor * (distance / prevDistance) + 1 - slowDownFactor;
    if (factor === 1) {
      return;
    }
    const rotationMatrix = this.#getRotationMatrix(this.rotation);
    const transf = (x, y) => [rotationMatrix[0] * x + rotationMatrix[2] * y, rotationMatrix[1] * x + rotationMatrix[3] * y];
    const [parentWidth, parentHeight] = this.parentDimensions;
    const savedX = this.x;
    const savedY = this.y;
    const savedWidth = this.width;
    const savedHeight = this.height;
    const minWidth = _AnnotationEditor.MIN_SIZE / parentWidth;
    const minHeight = _AnnotationEditor.MIN_SIZE / parentHeight;
    factor = Math.max(Math.min(factor, 1 / savedWidth, 1 / savedHeight), minWidth / savedWidth, minHeight / savedHeight);
    const newWidth = _AnnotationEditor._round(savedWidth * factor);
    const newHeight = _AnnotationEditor._round(savedHeight * factor);
    if (newWidth === savedWidth && newHeight === savedHeight) {
      return;
    }
    this.#initialRect ||= [savedX, savedY, savedWidth, savedHeight];
    const transfCenterPoint = transf(savedWidth / 2, savedHeight / 2);
    const centerX = _AnnotationEditor._round(savedX + transfCenterPoint[0]);
    const centerY = _AnnotationEditor._round(savedY + transfCenterPoint[1]);
    const newTransfCenterPoint = transf(newWidth / 2, newHeight / 2);
    this.x = centerX - newTransfCenterPoint[0];
    this.y = centerY - newTransfCenterPoint[1];
    this.width = newWidth;
    this.height = newHeight;
    this.setDims(parentWidth * newWidth, parentHeight * newHeight);
    this.fixAndSetPosition();
    this._onResizing();
  }
  #touchPinchEndCallback() {
    this.#altText?.toggle(true);
    this.parent.togglePointerEvents(true);
    this.#addResizeToUndoStack();
  }
  pointerdown(event) {
    const {
      isMac
    } = util_FeatureTest.platform;
    if (event.button !== 0 || event.ctrlKey && isMac) {
      event.preventDefault();
      return;
    }
    this.#hasBeenClicked = true;
    if (this._isDraggable) {
      this.#setUpDragSession(event);
      return;
    }
    this.#selectOnPointerEvent(event);
  }
  get isSelected() {
    return this._uiManager.isSelected(this);
  }
  #selectOnPointerEvent(event) {
    const {
      isMac
    } = util_FeatureTest.platform;
    if (event.ctrlKey && !isMac || event.shiftKey || event.metaKey && isMac) {
      this.parent.toggleSelected(this);
    } else {
      this.parent.setSelected(this);
    }
  }
  #setUpDragSession(event) {
    const {
      isSelected
    } = this;
    this._uiManager.setUpDragSession();
    let hasDraggingStarted = false;
    const ac = new AbortController();
    const signal = this._uiManager.combinedSignal(ac);
    const opts = {
      capture: true,
      passive: false,
      signal
    };
    const cancelDrag = (e) => {
      ac.abort();
      this.#dragPointerId = null;
      this.#hasBeenClicked = false;
      if (!this._uiManager.endDragSession()) {
        this.#selectOnPointerEvent(e);
      }
      if (hasDraggingStarted) {
        this._onStopDragging();
      }
    };
    if (isSelected) {
      this.#prevDragX = event.clientX;
      this.#prevDragY = event.clientY;
      this.#dragPointerId = event.pointerId;
      this.#dragPointerType = event.pointerType;
      window.addEventListener("pointermove", (e) => {
        if (!hasDraggingStarted) {
          hasDraggingStarted = true;
          this._onStartDragging();
        }
        const {
          clientX: x,
          clientY: y,
          pointerId
        } = e;
        if (pointerId !== this.#dragPointerId) {
          stopEvent(e);
          return;
        }
        const [tx, ty] = this.screenToPageTranslation(x - this.#prevDragX, y - this.#prevDragY);
        this.#prevDragX = x;
        this.#prevDragY = y;
        this._uiManager.dragSelectedEditors(tx, ty);
      }, opts);
      window.addEventListener("touchmove", stopEvent, opts);
      window.addEventListener("pointerdown", (e) => {
        if (e.pointerType === this.#dragPointerType) {
          if (this.#touchManager || e.isPrimary) {
            cancelDrag(e);
          }
        }
        stopEvent(e);
      }, opts);
    }
    const pointerUpCallback = (e) => {
      if (!this.#dragPointerId || this.#dragPointerId === e.pointerId) {
        cancelDrag(e);
        return;
      }
      stopEvent(e);
    };
    window.addEventListener("pointerup", pointerUpCallback, {
      signal
    });
    window.addEventListener("blur", pointerUpCallback, {
      signal
    });
  }
  _onStartDragging() {
  }
  _onStopDragging() {
  }
  moveInDOM() {
    if (this.#moveInDOMTimeout) {
      clearTimeout(this.#moveInDOMTimeout);
    }
    this.#moveInDOMTimeout = setTimeout(() => {
      this.#moveInDOMTimeout = null;
      this.parent?.moveEditorInDOM(this);
    }, 0);
  }
  _setParentAndPosition(parent, x, y) {
    parent.changeParent(this);
    this.x = x;
    this.y = y;
    this.fixAndSetPosition();
    this._onTranslated();
  }
  getRect(tx, ty, rotation = this.rotation) {
    const scale = this.parentScale;
    const [pageWidth, pageHeight] = this.pageDimensions;
    const [pageX, pageY] = this.pageTranslation;
    const shiftX = tx / scale;
    const shiftY = ty / scale;
    const x = this.x * pageWidth;
    const y = this.y * pageHeight;
    const width = this.width * pageWidth;
    const height = this.height * pageHeight;
    switch (rotation) {
      case 0:
        return [x + shiftX + pageX, pageHeight - y - shiftY - height + pageY, x + shiftX + width + pageX, pageHeight - y - shiftY + pageY];
      case 90:
        return [x + shiftY + pageX, pageHeight - y + shiftX + pageY, x + shiftY + height + pageX, pageHeight - y + shiftX + width + pageY];
      case 180:
        return [x - shiftX - width + pageX, pageHeight - y + shiftY + pageY, x - shiftX + pageX, pageHeight - y + shiftY + height + pageY];
      case 270:
        return [x - shiftY - height + pageX, pageHeight - y - shiftX - width + pageY, x - shiftY + pageX, pageHeight - y - shiftX + pageY];
      default:
        throw new Error("Invalid rotation");
    }
  }
  getRectInCurrentCoords(rect, pageHeight) {
    const [x1, y1, x2, y2] = rect;
    const width = x2 - x1;
    const height = y2 - y1;
    switch (this.rotation) {
      case 0:
        return [x1, pageHeight - y2, width, height];
      case 90:
        return [x1, pageHeight - y1, height, width];
      case 180:
        return [x2, pageHeight - y1, width, height];
      case 270:
        return [x2, pageHeight - y2, height, width];
      default:
        throw new Error("Invalid rotation");
    }
  }
  onceAdded(focus) {
  }
  isEmpty() {
    return false;
  }
  enableEditMode() {
    this.#isInEditMode = true;
  }
  disableEditMode() {
    this.#isInEditMode = false;
  }
  isInEditMode() {
    return this.#isInEditMode;
  }
  shouldGetKeyboardEvents() {
    return this.#isResizerEnabledForKeyboard;
  }
  needsToBeRebuilt() {
    return this.div && !this.isAttachedToDOM;
  }
  get isOnScreen() {
    const {
      top,
      left,
      bottom,
      right
    } = this.getClientDimensions();
    const {
      innerHeight,
      innerWidth
    } = window;
    return left < innerWidth && right > 0 && top < innerHeight && bottom > 0;
  }
  #addFocusListeners() {
    if (this.#focusAC || !this.div) {
      return;
    }
    this.#focusAC = new AbortController();
    const signal = this._uiManager.combinedSignal(this.#focusAC);
    this.div.addEventListener("focusin", this.focusin.bind(this), {
      signal
    });
    this.div.addEventListener("focusout", this.focusout.bind(this), {
      signal
    });
  }
  rebuild() {
    this.#addFocusListeners();
  }
  rotate(_angle) {
  }
  resize() {
  }
  serializeDeleted() {
    return {
      id: this.annotationElementId,
      deleted: true,
      pageIndex: this.pageIndex,
      popupRef: this._initialData?.popupRef || ""
    };
  }
  serialize(isForCopying = false, context = null) {
    unreachable("An editor must be serializable");
  }
  static async deserialize(data, parent, uiManager) {
    const editor = new this.prototype.constructor({
      parent,
      id: parent.getNextId(),
      uiManager
    });
    editor.rotation = data.rotation;
    editor.#accessibilityData = data.accessibilityData;
    const [pageWidth, pageHeight] = editor.pageDimensions;
    const [x, y, width, height] = editor.getRectInCurrentCoords(data.rect, pageHeight);
    editor.x = x / pageWidth;
    editor.y = y / pageHeight;
    editor.width = width / pageWidth;
    editor.height = height / pageHeight;
    return editor;
  }
  get hasBeenModified() {
    return !!this.annotationElementId && (this.deleted || this.serialize() !== null);
  }
  remove() {
    this.#focusAC?.abort();
    this.#focusAC = null;
    if (!this.isEmpty()) {
      this.commit();
    }
    if (this.parent) {
      this.parent.remove(this);
    } else {
      this._uiManager.removeEditor(this);
    }
    if (this.#moveInDOMTimeout) {
      clearTimeout(this.#moveInDOMTimeout);
      this.#moveInDOMTimeout = null;
    }
    this.#stopResizing();
    this.removeEditToolbar();
    if (this.#telemetryTimeouts) {
      for (const timeout of this.#telemetryTimeouts.values()) {
        clearTimeout(timeout);
      }
      this.#telemetryTimeouts = null;
    }
    this.parent = null;
    this.#touchManager?.destroy();
    this.#touchManager = null;
  }
  get isResizable() {
    return false;
  }
  makeResizable() {
    if (this.isResizable) {
      this.#createResizers();
      this.#resizersDiv.classList.remove("hidden");
      bindEvents(this, this.div, ["keydown"]);
    }
  }
  get toolbarPosition() {
    return null;
  }
  keydown(event) {
    if (!this.isResizable || event.target !== this.div || event.key !== "Enter") {
      return;
    }
    this._uiManager.setSelected(this);
    this.#savedDimensions = {
      savedX: this.x,
      savedY: this.y,
      savedWidth: this.width,
      savedHeight: this.height
    };
    const children = this.#resizersDiv.children;
    if (!this.#allResizerDivs) {
      this.#allResizerDivs = Array.from(children);
      const boundResizerKeydown = this.#resizerKeydown.bind(this);
      const boundResizerBlur = this.#resizerBlur.bind(this);
      const signal = this._uiManager._signal;
      for (const div of this.#allResizerDivs) {
        const name = div.getAttribute("data-resizer-name");
        div.setAttribute("role", "spinbutton");
        div.addEventListener("keydown", boundResizerKeydown, {
          signal
        });
        div.addEventListener("blur", boundResizerBlur, {
          signal
        });
        div.addEventListener("focus", this.#resizerFocus.bind(this, name), {
          signal
        });
        div.setAttribute("data-l10n-id", _AnnotationEditor._l10nResizer[name]);
      }
    }
    const first = this.#allResizerDivs[0];
    let firstPosition = 0;
    for (const div of children) {
      if (div === first) {
        break;
      }
      firstPosition++;
    }
    const nextFirstPosition = (360 - this.rotation + this.parentRotation) % 360 / 90 * (this.#allResizerDivs.length / 4);
    if (nextFirstPosition !== firstPosition) {
      if (nextFirstPosition < firstPosition) {
        for (let i2 = 0; i2 < firstPosition - nextFirstPosition; i2++) {
          this.#resizersDiv.append(this.#resizersDiv.firstChild);
        }
      } else if (nextFirstPosition > firstPosition) {
        for (let i2 = 0; i2 < nextFirstPosition - firstPosition; i2++) {
          this.#resizersDiv.firstChild.before(this.#resizersDiv.lastChild);
        }
      }
      let i = 0;
      for (const child of children) {
        const div = this.#allResizerDivs[i++];
        const name = div.getAttribute("data-resizer-name");
        child.setAttribute("data-l10n-id", _AnnotationEditor._l10nResizer[name]);
      }
    }
    this.#setResizerTabIndex(0);
    this.#isResizerEnabledForKeyboard = true;
    this.#resizersDiv.firstChild.focus({
      focusVisible: true
    });
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  #resizerKeydown(event) {
    _AnnotationEditor._resizerKeyboardManager.exec(this, event);
  }
  #resizerBlur(event) {
    if (this.#isResizerEnabledForKeyboard && event.relatedTarget?.parentNode !== this.#resizersDiv) {
      this.#stopResizing();
    }
  }
  #resizerFocus(name) {
    this.#focusedResizerName = this.#isResizerEnabledForKeyboard ? name : "";
  }
  #setResizerTabIndex(value) {
    if (!this.#allResizerDivs) {
      return;
    }
    for (const div of this.#allResizerDivs) {
      div.tabIndex = value;
    }
  }
  _resizeWithKeyboard(x, y) {
    if (!this.#isResizerEnabledForKeyboard) {
      return;
    }
    this.#resizerPointermove(this.#focusedResizerName, {
      deltaX: x,
      deltaY: y,
      fromKeyboard: true
    });
  }
  #stopResizing() {
    this.#isResizerEnabledForKeyboard = false;
    this.#setResizerTabIndex(-1);
    this.#addResizeToUndoStack();
  }
  _stopResizingWithKeyboard() {
    this.#stopResizing();
    this.div.focus();
  }
  select() {
    this.makeResizable();
    this.div?.classList.add("selectedEditor");
    if (!this._editToolbar) {
      this.addEditToolbar().then(() => {
        if (this.div?.classList.contains("selectedEditor")) {
          this._editToolbar?.show();
        }
      });
      return;
    }
    this._editToolbar?.show();
    this.#altText?.toggleAltTextBadge(false);
  }
  unselect() {
    this.#resizersDiv?.classList.add("hidden");
    this.div?.classList.remove("selectedEditor");
    if (this.div?.contains(document.activeElement)) {
      this._uiManager.currentLayer.div.focus({
        preventScroll: true
      });
    }
    this._editToolbar?.hide();
    this.#altText?.toggleAltTextBadge(true);
  }
  updateParams(type, value) {
  }
  disableEditing() {
  }
  enableEditing() {
  }
  enterInEditMode() {
  }
  getImageForAltText() {
    return null;
  }
  get contentDiv() {
    return this.div;
  }
  get isEditing() {
    return this.#isEditing;
  }
  set isEditing(value) {
    this.#isEditing = value;
    if (!this.parent) {
      return;
    }
    if (value) {
      this.parent.setSelected(this);
      this.parent.setActiveEditor(this);
    } else {
      this.parent.setActiveEditor(null);
    }
  }
  setAspectRatio(width, height) {
    this.#keepAspectRatio = true;
    const aspectRatio = width / height;
    const {
      style
    } = this.div;
    style.aspectRatio = aspectRatio;
    style.height = "auto";
  }
  static get MIN_SIZE() {
    return 16;
  }
  static canCreateNewEmptyEditor() {
    return true;
  }
  get telemetryInitialData() {
    return {
      action: "added"
    };
  }
  get telemetryFinalData() {
    return null;
  }
  _reportTelemetry(data, mustWait = false) {
    if (mustWait) {
      this.#telemetryTimeouts ||= /* @__PURE__ */ new Map();
      const {
        action
      } = data;
      let timeout = this.#telemetryTimeouts.get(action);
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        this._reportTelemetry(data);
        this.#telemetryTimeouts.delete(action);
        if (this.#telemetryTimeouts.size === 0) {
          this.#telemetryTimeouts = null;
        }
      }, _AnnotationEditor._telemetryTimeout);
      this.#telemetryTimeouts.set(action, timeout);
      return;
    }
    data.type ||= this.editorType;
    this._uiManager._eventBus.dispatch("reporttelemetry", {
      source: this,
      details: {
        type: "editing",
        data
      }
    });
  }
  show(visible = this._isVisible) {
    this.div.classList.toggle("hidden", !visible);
    this._isVisible = visible;
  }
  enable() {
    if (this.div) {
      this.div.tabIndex = 0;
    }
    this.#disabled = false;
  }
  disable() {
    if (this.div) {
      this.div.tabIndex = -1;
    }
    this.#disabled = true;
  }
  renderAnnotationElement(annotation) {
    let content = annotation.container.querySelector(".annotationContent");
    if (!content) {
      content = document.createElement("div");
      content.classList.add("annotationContent", this.editorType);
      annotation.container.prepend(content);
    } else if (content.nodeName === "CANVAS") {
      const canvas = content;
      content = document.createElement("div");
      content.classList.add("annotationContent", this.editorType);
      canvas.before(content);
    }
    return content;
  }
  resetAnnotationElement(annotation) {
    const {
      firstChild
    } = annotation.container;
    if (firstChild?.nodeName === "DIV" && firstChild.classList.contains("annotationContent")) {
      firstChild.remove();
    }
  }
};
var FakeEditor = class extends AnnotationEditor {
  constructor(params) {
    super(params);
    this.annotationElementId = params.annotationElementId;
    this.deleted = true;
  }
  serialize() {
    return this.serializeDeleted();
  }
};
var SEED = 3285377520;
var MASK_HIGH = 4294901760;
var MASK_LOW = 65535;
var MurmurHash3_64 = class {
  constructor(seed) {
    this.h1 = seed ? seed & 4294967295 : SEED;
    this.h2 = seed ? seed & 4294967295 : SEED;
  }
  update(input) {
    let data, length;
    if (typeof input === "string") {
      data = new Uint8Array(input.length * 2);
      length = 0;
      for (let i = 0, ii = input.length; i < ii; i++) {
        const code = input.charCodeAt(i);
        if (code <= 255) {
          data[length++] = code;
        } else {
          data[length++] = code >>> 8;
          data[length++] = code & 255;
        }
      }
    } else if (ArrayBuffer.isView(input)) {
      data = input.slice();
      length = data.byteLength;
    } else {
      throw new Error("Invalid data format, must be a string or TypedArray.");
    }
    const blockCounts = length >> 2;
    const tailLength = length - blockCounts * 4;
    const dataUint32 = new Uint32Array(data.buffer, 0, blockCounts);
    let k1 = 0, k2 = 0;
    let h1 = this.h1, h2 = this.h2;
    const C1 = 3432918353, C2 = 461845907;
    const C1_LOW = C1 & MASK_LOW, C2_LOW = C2 & MASK_LOW;
    for (let i = 0; i < blockCounts; i++) {
      if (i & 1) {
        k1 = dataUint32[i];
        k1 = k1 * C1 & MASK_HIGH | k1 * C1_LOW & MASK_LOW;
        k1 = k1 << 15 | k1 >>> 17;
        k1 = k1 * C2 & MASK_HIGH | k1 * C2_LOW & MASK_LOW;
        h1 ^= k1;
        h1 = h1 << 13 | h1 >>> 19;
        h1 = h1 * 5 + 3864292196;
      } else {
        k2 = dataUint32[i];
        k2 = k2 * C1 & MASK_HIGH | k2 * C1_LOW & MASK_LOW;
        k2 = k2 << 15 | k2 >>> 17;
        k2 = k2 * C2 & MASK_HIGH | k2 * C2_LOW & MASK_LOW;
        h2 ^= k2;
        h2 = h2 << 13 | h2 >>> 19;
        h2 = h2 * 5 + 3864292196;
      }
    }
    k1 = 0;
    switch (tailLength) {
      case 3:
        k1 ^= data[blockCounts * 4 + 2] << 16;
      case 2:
        k1 ^= data[blockCounts * 4 + 1] << 8;
      case 1:
        k1 ^= data[blockCounts * 4];
        k1 = k1 * C1 & MASK_HIGH | k1 * C1_LOW & MASK_LOW;
        k1 = k1 << 15 | k1 >>> 17;
        k1 = k1 * C2 & MASK_HIGH | k1 * C2_LOW & MASK_LOW;
        if (blockCounts & 1) {
          h1 ^= k1;
        } else {
          h2 ^= k1;
        }
    }
    this.h1 = h1;
    this.h2 = h2;
  }
  hexdigest() {
    let h1 = this.h1, h2 = this.h2;
    h1 ^= h2 >>> 1;
    h1 = h1 * 3981806797 & MASK_HIGH | h1 * 36045 & MASK_LOW;
    h2 = h2 * 4283543511 & MASK_HIGH | ((h2 << 16 | h1 >>> 16) * 2950163797 & MASK_HIGH) >>> 16;
    h1 ^= h2 >>> 1;
    h1 = h1 * 444984403 & MASK_HIGH | h1 * 60499 & MASK_LOW;
    h2 = h2 * 3301882366 & MASK_HIGH | ((h2 << 16 | h1 >>> 16) * 3120437893 & MASK_HIGH) >>> 16;
    h1 ^= h2 >>> 1;
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  }
};
var SerializableEmpty = Object.freeze({
  map: null,
  hash: "",
  transfer: void 0
});
var AnnotationStorage = class {
  #modified = false;
  #modifiedIds = null;
  #storage = /* @__PURE__ */ new Map();
  constructor() {
    this.onSetModified = null;
    this.onResetModified = null;
    this.onAnnotationEditor = null;
  }
  getValue(key, defaultValue) {
    const value = this.#storage.get(key);
    if (value === void 0) {
      return defaultValue;
    }
    return Object.assign(defaultValue, value);
  }
  getRawValue(key) {
    return this.#storage.get(key);
  }
  remove(key) {
    this.#storage.delete(key);
    if (this.#storage.size === 0) {
      this.resetModified();
    }
    if (typeof this.onAnnotationEditor === "function") {
      for (const value of this.#storage.values()) {
        if (value instanceof AnnotationEditor) {
          return;
        }
      }
      this.onAnnotationEditor(null);
    }
  }
  setValue(key, value) {
    const obj = this.#storage.get(key);
    let modified = false;
    if (obj !== void 0) {
      for (const [entry, val] of Object.entries(value)) {
        if (obj[entry] !== val) {
          modified = true;
          obj[entry] = val;
        }
      }
    } else {
      modified = true;
      this.#storage.set(key, value);
    }
    if (modified) {
      this.#setModified();
    }
    if (value instanceof AnnotationEditor && typeof this.onAnnotationEditor === "function") {
      this.onAnnotationEditor(value.constructor._type);
    }
  }
  has(key) {
    return this.#storage.has(key);
  }
  getAll() {
    return this.#storage.size > 0 ? objectFromMap(this.#storage) : null;
  }
  setAll(obj) {
    for (const [key, val] of Object.entries(obj)) {
      this.setValue(key, val);
    }
  }
  get size() {
    return this.#storage.size;
  }
  #setModified() {
    if (!this.#modified) {
      this.#modified = true;
      if (typeof this.onSetModified === "function") {
        this.onSetModified();
      }
    }
  }
  resetModified() {
    if (this.#modified) {
      this.#modified = false;
      if (typeof this.onResetModified === "function") {
        this.onResetModified();
      }
    }
  }
  get print() {
    return new PrintAnnotationStorage(this);
  }
  get serializable() {
    if (this.#storage.size === 0) {
      return SerializableEmpty;
    }
    const map = /* @__PURE__ */ new Map(), hash = new MurmurHash3_64(), transfer = [];
    const context = /* @__PURE__ */ Object.create(null);
    let hasBitmap = false;
    for (const [key, val] of this.#storage) {
      const serialized = val instanceof AnnotationEditor ? val.serialize(false, context) : val;
      if (serialized) {
        map.set(key, serialized);
        hash.update(`${key}:${JSON.stringify(serialized)}`);
        hasBitmap ||= !!serialized.bitmap;
      }
    }
    if (hasBitmap) {
      for (const value of map.values()) {
        if (value.bitmap) {
          transfer.push(value.bitmap);
        }
      }
    }
    return map.size > 0 ? {
      map,
      hash: hash.hexdigest(),
      transfer
    } : SerializableEmpty;
  }
  get editorStats() {
    let stats = null;
    const typeToEditor = /* @__PURE__ */ new Map();
    for (const value of this.#storage.values()) {
      if (!(value instanceof AnnotationEditor)) {
        continue;
      }
      const editorStats = value.telemetryFinalData;
      if (!editorStats) {
        continue;
      }
      const {
        type
      } = editorStats;
      if (!typeToEditor.has(type)) {
        typeToEditor.set(type, Object.getPrototypeOf(value).constructor);
      }
      stats ||= /* @__PURE__ */ Object.create(null);
      const map = stats[type] ||= /* @__PURE__ */ new Map();
      for (const [key, val] of Object.entries(editorStats)) {
        if (key === "type") {
          continue;
        }
        let counters = map.get(key);
        if (!counters) {
          counters = /* @__PURE__ */ new Map();
          map.set(key, counters);
        }
        const count = counters.get(val) ?? 0;
        counters.set(val, count + 1);
      }
    }
    for (const [type, editor] of typeToEditor) {
      stats[type] = editor.computeTelemetryFinalData(stats[type]);
    }
    return stats;
  }
  resetModifiedIds() {
    this.#modifiedIds = null;
  }
  get modifiedIds() {
    if (this.#modifiedIds) {
      return this.#modifiedIds;
    }
    const ids = [];
    for (const value of this.#storage.values()) {
      if (!(value instanceof AnnotationEditor) || !value.annotationElementId || !value.serialize()) {
        continue;
      }
      ids.push(value.annotationElementId);
    }
    return this.#modifiedIds = {
      ids: new Set(ids),
      hash: ids.join(",")
    };
  }
};
var PrintAnnotationStorage = class extends AnnotationStorage {
  #serializable;
  constructor(parent) {
    super();
    const {
      map,
      hash,
      transfer
    } = parent.serializable;
    const clone = structuredClone(map, transfer ? {
      transfer
    } : null);
    this.#serializable = {
      map: clone,
      hash,
      transfer
    };
  }
  get print() {
    unreachable("Should not call PrintAnnotationStorage.print");
  }
  get serializable() {
    return this.#serializable;
  }
  get modifiedIds() {
    return shadow(this, "modifiedIds", {
      ids: /* @__PURE__ */ new Set(),
      hash: ""
    });
  }
};
var FontLoader = class {
  #systemFonts = /* @__PURE__ */ new Set();
  constructor({
    ownerDocument = globalThis.document,
    styleElement = null
  }) {
    this._document = ownerDocument;
    this.nativeFontFaces = /* @__PURE__ */ new Set();
    this.styleElement = null;
    this.loadingRequests = [];
    this.loadTestFontId = 0;
  }
  addNativeFontFace(nativeFontFace) {
    this.nativeFontFaces.add(nativeFontFace);
    this._document.fonts.add(nativeFontFace);
  }
  removeNativeFontFace(nativeFontFace) {
    this.nativeFontFaces.delete(nativeFontFace);
    this._document.fonts.delete(nativeFontFace);
  }
  insertRule(rule) {
    if (!this.styleElement) {
      this.styleElement = this._document.createElement("style");
      this._document.documentElement.getElementsByTagName("head")[0].append(this.styleElement);
    }
    const styleSheet = this.styleElement.sheet;
    styleSheet.insertRule(rule, styleSheet.cssRules.length);
  }
  clear() {
    for (const nativeFontFace of this.nativeFontFaces) {
      this._document.fonts.delete(nativeFontFace);
    }
    this.nativeFontFaces.clear();
    this.#systemFonts.clear();
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }
  async loadSystemFont({
    systemFontInfo: info2,
    _inspectFont
  }) {
    if (!info2 || this.#systemFonts.has(info2.loadedName)) {
      return;
    }
    assert(!this.disableFontFace, "loadSystemFont shouldn't be called when `disableFontFace` is set.");
    if (this.isFontLoadingAPISupported) {
      const {
        loadedName,
        src,
        style
      } = info2;
      const fontFace = new FontFace(loadedName, src, style);
      this.addNativeFontFace(fontFace);
      try {
        await fontFace.load();
        this.#systemFonts.add(loadedName);
        _inspectFont?.(info2);
      } catch {
        warn(`Cannot load system font: ${info2.baseFontName}, installing it could help to improve PDF rendering.`);
        this.removeNativeFontFace(fontFace);
      }
      return;
    }
    unreachable("Not implemented: loadSystemFont without the Font Loading API.");
  }
  async bind(font) {
    if (font.attached || font.missingFile && !font.systemFontInfo) {
      return;
    }
    font.attached = true;
    if (font.systemFontInfo) {
      await this.loadSystemFont(font);
      return;
    }
    if (this.isFontLoadingAPISupported) {
      const nativeFontFace = font.createNativeFontFace();
      if (nativeFontFace) {
        this.addNativeFontFace(nativeFontFace);
        try {
          await nativeFontFace.loaded;
        } catch (ex) {
          warn(`Failed to load font '${nativeFontFace.family}': '${ex}'.`);
          font.disableFontFace = true;
          throw ex;
        }
      }
      return;
    }
    const rule = font.createFontFaceRule();
    if (rule) {
      this.insertRule(rule);
      if (this.isSyncFontLoadingSupported) {
        return;
      }
      await new Promise((resolve) => {
        const request = this._queueLoadingCallback(resolve);
        this._prepareFontLoadEvent(font, request);
      });
    }
  }
  get isFontLoadingAPISupported() {
    const hasFonts = !!this._document?.fonts;
    return shadow(this, "isFontLoadingAPISupported", hasFonts);
  }
  get isSyncFontLoadingSupported() {
    let supported = false;
    if (isNodeJS) {
      supported = true;
    } else if (typeof navigator !== "undefined" && typeof navigator?.userAgent === "string" && /Mozilla\/5.0.*?rv:\d+.*? Gecko/.test(navigator.userAgent)) {
      supported = true;
    }
    return shadow(this, "isSyncFontLoadingSupported", supported);
  }
  _queueLoadingCallback(callback) {
    function completeRequest() {
      assert(!request.done, "completeRequest() cannot be called twice.");
      request.done = true;
      while (loadingRequests.length > 0 && loadingRequests[0].done) {
        const otherRequest = loadingRequests.shift();
        setTimeout(otherRequest.callback, 0);
      }
    }
    const {
      loadingRequests
    } = this;
    const request = {
      done: false,
      complete: completeRequest,
      callback
    };
    loadingRequests.push(request);
    return request;
  }
  get _loadTestFont() {
    const testFont = atob("T1RUTwALAIAAAwAwQ0ZGIDHtZg4AAAOYAAAAgUZGVE1lkzZwAAAEHAAAABxHREVGABQAFQAABDgAAAAeT1MvMlYNYwkAAAEgAAAAYGNtYXABDQLUAAACNAAAAUJoZWFk/xVFDQAAALwAAAA2aGhlYQdkA+oAAAD0AAAAJGhtdHgD6AAAAAAEWAAAAAZtYXhwAAJQAAAAARgAAAAGbmFtZVjmdH4AAAGAAAAAsXBvc3T/hgAzAAADeAAAACAAAQAAAAEAALZRFsRfDzz1AAsD6AAAAADOBOTLAAAAAM4KHDwAAAAAA+gDIQAAAAgAAgAAAAAAAAABAAADIQAAAFoD6AAAAAAD6AABAAAAAAAAAAAAAAAAAAAAAQAAUAAAAgAAAAQD6AH0AAUAAAKKArwAAACMAooCvAAAAeAAMQECAAACAAYJAAAAAAAAAAAAAQAAAAAAAAAAAAAAAFBmRWQAwAAuAC4DIP84AFoDIQAAAAAAAQAAAAAAAAAAACAAIAABAAAADgCuAAEAAAAAAAAAAQAAAAEAAAAAAAEAAQAAAAEAAAAAAAIAAQAAAAEAAAAAAAMAAQAAAAEAAAAAAAQAAQAAAAEAAAAAAAUAAQAAAAEAAAAAAAYAAQAAAAMAAQQJAAAAAgABAAMAAQQJAAEAAgABAAMAAQQJAAIAAgABAAMAAQQJAAMAAgABAAMAAQQJAAQAAgABAAMAAQQJAAUAAgABAAMAAQQJAAYAAgABWABYAAAAAAAAAwAAAAMAAAAcAAEAAAAAADwAAwABAAAAHAAEACAAAAAEAAQAAQAAAC7//wAAAC7////TAAEAAAAAAAABBgAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAD/gwAyAAAAAQAAAAAAAAAAAAAAAAAAAAABAAQEAAEBAQJYAAEBASH4DwD4GwHEAvgcA/gXBIwMAYuL+nz5tQXkD5j3CBLnEQACAQEBIVhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYAAABAQAADwACAQEEE/t3Dov6fAH6fAT+fPp8+nwHDosMCvm1Cvm1DAz6fBQAAAAAAAABAAAAAMmJbzEAAAAAzgTjFQAAAADOBOQpAAEAAAAAAAAADAAUAAQAAAABAAAAAgABAAAAAAAAAAAD6AAAAAAAAA==");
    return shadow(this, "_loadTestFont", testFont);
  }
  _prepareFontLoadEvent(font, request) {
    function int32(data2, offset) {
      return data2.charCodeAt(offset) << 24 | data2.charCodeAt(offset + 1) << 16 | data2.charCodeAt(offset + 2) << 8 | data2.charCodeAt(offset + 3) & 255;
    }
    function spliceString(s, offset, remove, insert) {
      const chunk1 = s.substring(0, offset);
      const chunk2 = s.substring(offset + remove);
      return chunk1 + insert + chunk2;
    }
    let i, ii;
    const canvas = this._document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    let called = 0;
    function isFontReady(name, callback) {
      if (++called > 30) {
        warn("Load test font never loaded.");
        callback();
        return;
      }
      ctx.font = "30px " + name;
      ctx.fillText(".", 0, 20);
      const imageData = ctx.getImageData(0, 0, 1, 1);
      if (imageData.data[3] > 0) {
        callback();
        return;
      }
      setTimeout(isFontReady.bind(null, name, callback));
    }
    const loadTestFontId = `lt${Date.now()}${this.loadTestFontId++}`;
    let data = this._loadTestFont;
    const COMMENT_OFFSET = 976;
    data = spliceString(data, COMMENT_OFFSET, loadTestFontId.length, loadTestFontId);
    const CFF_CHECKSUM_OFFSET = 16;
    const XXXX_VALUE = 1482184792;
    let checksum = int32(data, CFF_CHECKSUM_OFFSET);
    for (i = 0, ii = loadTestFontId.length - 3; i < ii; i += 4) {
      checksum = checksum - XXXX_VALUE + int32(loadTestFontId, i) | 0;
    }
    if (i < loadTestFontId.length) {
      checksum = checksum - XXXX_VALUE + int32(loadTestFontId + "XXX", i) | 0;
    }
    data = spliceString(data, CFF_CHECKSUM_OFFSET, 4, string32(checksum));
    const url = `url(data:font/opentype;base64,${btoa(data)});`;
    const rule = `@font-face {font-family:"${loadTestFontId}";src:${url}}`;
    this.insertRule(rule);
    const div = this._document.createElement("div");
    div.style.visibility = "hidden";
    div.style.width = div.style.height = "10px";
    div.style.position = "absolute";
    div.style.top = div.style.left = "0px";
    for (const name of [font.loadedName, loadTestFontId]) {
      const span = this._document.createElement("span");
      span.textContent = "Hi";
      span.style.fontFamily = name;
      div.append(span);
    }
    this._document.body.append(div);
    isFontReady(loadTestFontId, () => {
      div.remove();
      request.complete();
    });
  }
};
var FontFaceObject = class {
  constructor(translatedData, {
    disableFontFace = false,
    fontExtraProperties = false,
    inspectFont = null
  }) {
    this.compiledGlyphs = /* @__PURE__ */ Object.create(null);
    for (const i in translatedData) {
      this[i] = translatedData[i];
    }
    this.disableFontFace = disableFontFace === true;
    this.fontExtraProperties = fontExtraProperties === true;
    this._inspectFont = inspectFont;
  }
  createNativeFontFace() {
    if (!this.data || this.disableFontFace) {
      return null;
    }
    let nativeFontFace;
    if (!this.cssFontInfo) {
      nativeFontFace = new FontFace(this.loadedName, this.data, {});
    } else {
      const css = {
        weight: this.cssFontInfo.fontWeight
      };
      if (this.cssFontInfo.italicAngle) {
        css.style = `oblique ${this.cssFontInfo.italicAngle}deg`;
      }
      nativeFontFace = new FontFace(this.cssFontInfo.fontFamily, this.data, css);
    }
    this._inspectFont?.(this);
    return nativeFontFace;
  }
  createFontFaceRule() {
    if (!this.data || this.disableFontFace) {
      return null;
    }
    const url = `url(data:${this.mimetype};base64,${toBase64Util(this.data)});`;
    let rule;
    if (!this.cssFontInfo) {
      rule = `@font-face {font-family:"${this.loadedName}";src:${url}}`;
    } else {
      let css = `font-weight: ${this.cssFontInfo.fontWeight};`;
      if (this.cssFontInfo.italicAngle) {
        css += `font-style: oblique ${this.cssFontInfo.italicAngle}deg;`;
      }
      rule = `@font-face {font-family:"${this.cssFontInfo.fontFamily}";${css}src:${url}}`;
    }
    this._inspectFont?.(this, url);
    return rule;
  }
  getPathGenerator(objs, character) {
    if (this.compiledGlyphs[character] !== void 0) {
      return this.compiledGlyphs[character];
    }
    const objId = this.loadedName + "_path_" + character;
    let cmds;
    try {
      cmds = objs.get(objId);
    } catch (ex) {
      warn(`getPathGenerator - ignoring character: "${ex}".`);
    }
    const path = new Path2D(cmds || "");
    if (!this.fontExtraProperties) {
      objs.delete(objId);
    }
    return this.compiledGlyphs[character] = path;
  }
};
var CallbackKind = {
  DATA: 1,
  ERROR: 2
};
var StreamKind = {
  CANCEL: 1,
  CANCEL_COMPLETE: 2,
  CLOSE: 3,
  ENQUEUE: 4,
  ERROR: 5,
  PULL: 6,
  PULL_COMPLETE: 7,
  START_COMPLETE: 8
};
function onFn() {
}
function wrapReason(ex) {
  if (ex instanceof AbortException || ex instanceof InvalidPDFException || ex instanceof MissingPDFException || ex instanceof PasswordException || ex instanceof UnexpectedResponseException || ex instanceof UnknownErrorException) {
    return ex;
  }
  if (!(ex instanceof Error || typeof ex === "object" && ex !== null)) {
    unreachable('wrapReason: Expected "reason" to be a (possibly cloned) Error.');
  }
  switch (ex.name) {
    case "AbortException":
      return new AbortException(ex.message);
    case "InvalidPDFException":
      return new InvalidPDFException(ex.message);
    case "MissingPDFException":
      return new MissingPDFException(ex.message);
    case "PasswordException":
      return new PasswordException(ex.message, ex.code);
    case "UnexpectedResponseException":
      return new UnexpectedResponseException(ex.message, ex.status);
    case "UnknownErrorException":
      return new UnknownErrorException(ex.message, ex.details);
  }
  return new UnknownErrorException(ex.message, ex.toString());
}
var MessageHandler = class {
  #messageAC = new AbortController();
  constructor(sourceName, targetName, comObj) {
    this.sourceName = sourceName;
    this.targetName = targetName;
    this.comObj = comObj;
    this.callbackId = 1;
    this.streamId = 1;
    this.streamSinks = /* @__PURE__ */ Object.create(null);
    this.streamControllers = /* @__PURE__ */ Object.create(null);
    this.callbackCapabilities = /* @__PURE__ */ Object.create(null);
    this.actionHandler = /* @__PURE__ */ Object.create(null);
    comObj.addEventListener("message", this.#onMessage.bind(this), {
      signal: this.#messageAC.signal
    });
  }
  #onMessage({
    data
  }) {
    if (data.targetName !== this.sourceName) {
      return;
    }
    if (data.stream) {
      this.#processStreamMessage(data);
      return;
    }
    if (data.callback) {
      const callbackId = data.callbackId;
      const capability = this.callbackCapabilities[callbackId];
      if (!capability) {
        throw new Error(`Cannot resolve callback ${callbackId}`);
      }
      delete this.callbackCapabilities[callbackId];
      if (data.callback === CallbackKind.DATA) {
        capability.resolve(data.data);
      } else if (data.callback === CallbackKind.ERROR) {
        capability.reject(wrapReason(data.reason));
      } else {
        throw new Error("Unexpected callback case");
      }
      return;
    }
    const action = this.actionHandler[data.action];
    if (!action) {
      throw new Error(`Unknown action from worker: ${data.action}`);
    }
    if (data.callbackId) {
      const sourceName = this.sourceName, targetName = data.sourceName, comObj = this.comObj;
      Promise.try(action, data.data).then(function(result) {
        comObj.postMessage({
          sourceName,
          targetName,
          callback: CallbackKind.DATA,
          callbackId: data.callbackId,
          data: result
        });
      }, function(reason) {
        comObj.postMessage({
          sourceName,
          targetName,
          callback: CallbackKind.ERROR,
          callbackId: data.callbackId,
          reason: wrapReason(reason)
        });
      });
      return;
    }
    if (data.streamId) {
      this.#createStreamSink(data);
      return;
    }
    action(data.data);
  }
  on(actionName, handler) {
    const ah = this.actionHandler;
    if (ah[actionName]) {
      throw new Error(`There is already an actionName called "${actionName}"`);
    }
    ah[actionName] = handler;
  }
  send(actionName, data, transfers) {
    this.comObj.postMessage({
      sourceName: this.sourceName,
      targetName: this.targetName,
      action: actionName,
      data
    }, transfers);
  }
  sendWithPromise(actionName, data, transfers) {
    const callbackId = this.callbackId++;
    const capability = Promise.withResolvers();
    this.callbackCapabilities[callbackId] = capability;
    try {
      this.comObj.postMessage({
        sourceName: this.sourceName,
        targetName: this.targetName,
        action: actionName,
        callbackId,
        data
      }, transfers);
    } catch (ex) {
      capability.reject(ex);
    }
    return capability.promise;
  }
  sendWithStream(actionName, data, queueingStrategy, transfers) {
    const streamId = this.streamId++, sourceName = this.sourceName, targetName = this.targetName, comObj = this.comObj;
    return new ReadableStream({
      start: (controller) => {
        const startCapability = Promise.withResolvers();
        this.streamControllers[streamId] = {
          controller,
          startCall: startCapability,
          pullCall: null,
          cancelCall: null,
          isClosed: false
        };
        comObj.postMessage({
          sourceName,
          targetName,
          action: actionName,
          streamId,
          data,
          desiredSize: controller.desiredSize
        }, transfers);
        return startCapability.promise;
      },
      pull: (controller) => {
        const pullCapability = Promise.withResolvers();
        this.streamControllers[streamId].pullCall = pullCapability;
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.PULL,
          streamId,
          desiredSize: controller.desiredSize
        });
        return pullCapability.promise;
      },
      cancel: (reason) => {
        assert(reason instanceof Error, "cancel must have a valid reason");
        const cancelCapability = Promise.withResolvers();
        this.streamControllers[streamId].cancelCall = cancelCapability;
        this.streamControllers[streamId].isClosed = true;
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.CANCEL,
          streamId,
          reason: wrapReason(reason)
        });
        return cancelCapability.promise;
      }
    }, queueingStrategy);
  }
  #createStreamSink(data) {
    const streamId = data.streamId, sourceName = this.sourceName, targetName = data.sourceName, comObj = this.comObj;
    const self2 = this, action = this.actionHandler[data.action];
    const streamSink = {
      enqueue(chunk, size = 1, transfers) {
        if (this.isCancelled) {
          return;
        }
        const lastDesiredSize = this.desiredSize;
        this.desiredSize -= size;
        if (lastDesiredSize > 0 && this.desiredSize <= 0) {
          this.sinkCapability = Promise.withResolvers();
          this.ready = this.sinkCapability.promise;
        }
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.ENQUEUE,
          streamId,
          chunk
        }, transfers);
      },
      close() {
        if (this.isCancelled) {
          return;
        }
        this.isCancelled = true;
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.CLOSE,
          streamId
        });
        delete self2.streamSinks[streamId];
      },
      error(reason) {
        assert(reason instanceof Error, "error must have a valid reason");
        if (this.isCancelled) {
          return;
        }
        this.isCancelled = true;
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.ERROR,
          streamId,
          reason: wrapReason(reason)
        });
      },
      sinkCapability: Promise.withResolvers(),
      onPull: null,
      onCancel: null,
      isCancelled: false,
      desiredSize: data.desiredSize,
      ready: null
    };
    streamSink.sinkCapability.resolve();
    streamSink.ready = streamSink.sinkCapability.promise;
    this.streamSinks[streamId] = streamSink;
    Promise.try(action, data.data, streamSink).then(function() {
      comObj.postMessage({
        sourceName,
        targetName,
        stream: StreamKind.START_COMPLETE,
        streamId,
        success: true
      });
    }, function(reason) {
      comObj.postMessage({
        sourceName,
        targetName,
        stream: StreamKind.START_COMPLETE,
        streamId,
        reason: wrapReason(reason)
      });
    });
  }
  #processStreamMessage(data) {
    const streamId = data.streamId, sourceName = this.sourceName, targetName = data.sourceName, comObj = this.comObj;
    const streamController = this.streamControllers[streamId], streamSink = this.streamSinks[streamId];
    switch (data.stream) {
      case StreamKind.START_COMPLETE:
        if (data.success) {
          streamController.startCall.resolve();
        } else {
          streamController.startCall.reject(wrapReason(data.reason));
        }
        break;
      case StreamKind.PULL_COMPLETE:
        if (data.success) {
          streamController.pullCall.resolve();
        } else {
          streamController.pullCall.reject(wrapReason(data.reason));
        }
        break;
      case StreamKind.PULL:
        if (!streamSink) {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.PULL_COMPLETE,
            streamId,
            success: true
          });
          break;
        }
        if (streamSink.desiredSize <= 0 && data.desiredSize > 0) {
          streamSink.sinkCapability.resolve();
        }
        streamSink.desiredSize = data.desiredSize;
        Promise.try(streamSink.onPull || onFn).then(function() {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.PULL_COMPLETE,
            streamId,
            success: true
          });
        }, function(reason) {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.PULL_COMPLETE,
            streamId,
            reason: wrapReason(reason)
          });
        });
        break;
      case StreamKind.ENQUEUE:
        assert(streamController, "enqueue should have stream controller");
        if (streamController.isClosed) {
          break;
        }
        streamController.controller.enqueue(data.chunk);
        break;
      case StreamKind.CLOSE:
        assert(streamController, "close should have stream controller");
        if (streamController.isClosed) {
          break;
        }
        streamController.isClosed = true;
        streamController.controller.close();
        this.#deleteStreamController(streamController, streamId);
        break;
      case StreamKind.ERROR:
        assert(streamController, "error should have stream controller");
        streamController.controller.error(wrapReason(data.reason));
        this.#deleteStreamController(streamController, streamId);
        break;
      case StreamKind.CANCEL_COMPLETE:
        if (data.success) {
          streamController.cancelCall.resolve();
        } else {
          streamController.cancelCall.reject(wrapReason(data.reason));
        }
        this.#deleteStreamController(streamController, streamId);
        break;
      case StreamKind.CANCEL:
        if (!streamSink) {
          break;
        }
        const dataReason = wrapReason(data.reason);
        Promise.try(streamSink.onCancel || onFn, dataReason).then(function() {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.CANCEL_COMPLETE,
            streamId,
            success: true
          });
        }, function(reason) {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.CANCEL_COMPLETE,
            streamId,
            reason: wrapReason(reason)
          });
        });
        streamSink.sinkCapability.reject(dataReason);
        streamSink.isCancelled = true;
        delete this.streamSinks[streamId];
        break;
      default:
        throw new Error("Unexpected stream case");
    }
  }
  async #deleteStreamController(streamController, streamId) {
    await Promise.allSettled([streamController.startCall?.promise, streamController.pullCall?.promise, streamController.cancelCall?.promise]);
    delete this.streamControllers[streamId];
  }
  destroy() {
    this.#messageAC?.abort();
    this.#messageAC = null;
  }
};
var BaseCanvasFactory = class {
  #enableHWA = false;
  constructor({
    enableHWA = false
  }) {
    this.#enableHWA = enableHWA;
  }
  create(width, height) {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    const canvas = this._createCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext("2d", {
        willReadFrequently: !this.#enableHWA
      })
    };
  }
  reset(canvasAndContext, width, height) {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas is not specified");
    }
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas is not specified");
    }
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
  _createCanvas(width, height) {
    unreachable("Abstract method `_createCanvas` called.");
  }
};
var DOMCanvasFactory = class extends BaseCanvasFactory {
  constructor({
    ownerDocument = globalThis.document,
    enableHWA = false
  }) {
    super({
      enableHWA
    });
    this._document = ownerDocument;
  }
  _createCanvas(width, height) {
    const canvas = this._document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
};
var BaseCMapReaderFactory = class {
  constructor({
    baseUrl = null,
    isCompressed = true
  }) {
    this.baseUrl = baseUrl;
    this.isCompressed = isCompressed;
  }
  async fetch({
    name
  }) {
    if (!this.baseUrl) {
      throw new Error("Ensure that the `cMapUrl` and `cMapPacked` API parameters are provided.");
    }
    if (!name) {
      throw new Error("CMap name must be specified.");
    }
    const url = this.baseUrl + name + (this.isCompressed ? ".bcmap" : "");
    return this._fetch(url).then((cMapData) => ({
      cMapData,
      isCompressed: this.isCompressed
    })).catch((reason) => {
      throw new Error(`Unable to load ${this.isCompressed ? "binary " : ""}CMap at: ${url}`);
    });
  }
  async _fetch(url) {
    unreachable("Abstract method `_fetch` called.");
  }
};
var DOMCMapReaderFactory = class extends BaseCMapReaderFactory {
  async _fetch(url) {
    const data = await fetchData(url, this.isCompressed ? "arraybuffer" : "text");
    return data instanceof ArrayBuffer ? new Uint8Array(data) : stringToBytes(data);
  }
};
var esnext_iterator_filter = __webpack_require__(4520);
var BaseFilterFactory = class {
  addFilter(maps) {
    return "none";
  }
  addHCMFilter(fgColor, bgColor) {
    return "none";
  }
  addAlphaFilter(map) {
    return "none";
  }
  addLuminosityFilter(map) {
    return "none";
  }
  addHighlightHCMFilter(filterName, fgColor, bgColor, newFgColor, newBgColor) {
    return "none";
  }
  destroy(keepHCM = false) {
  }
};
var DOMFilterFactory = class extends BaseFilterFactory {
  #baseUrl;
  #_cache;
  #_defs;
  #docId;
  #document;
  #_hcmCache;
  #id = 0;
  constructor({
    docId,
    ownerDocument = globalThis.document
  }) {
    super();
    this.#docId = docId;
    this.#document = ownerDocument;
  }
  get #cache() {
    return this.#_cache ||= /* @__PURE__ */ new Map();
  }
  get #hcmCache() {
    return this.#_hcmCache ||= /* @__PURE__ */ new Map();
  }
  get #defs() {
    if (!this.#_defs) {
      const div = this.#document.createElement("div");
      const {
        style
      } = div;
      style.visibility = "hidden";
      style.contain = "strict";
      style.width = style.height = 0;
      style.position = "absolute";
      style.top = style.left = 0;
      style.zIndex = -1;
      const svg = this.#document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", 0);
      svg.setAttribute("height", 0);
      this.#_defs = this.#document.createElementNS(SVG_NS, "defs");
      div.append(svg);
      svg.append(this.#_defs);
      this.#document.body.append(div);
    }
    return this.#_defs;
  }
  #createTables(maps) {
    if (maps.length === 1) {
      const mapR2 = maps[0];
      const buffer = new Array(256);
      for (let i = 0; i < 256; i++) {
        buffer[i] = mapR2[i] / 255;
      }
      const table = buffer.join(",");
      return [table, table, table];
    }
    const [mapR, mapG, mapB] = maps;
    const bufferR = new Array(256);
    const bufferG = new Array(256);
    const bufferB = new Array(256);
    for (let i = 0; i < 256; i++) {
      bufferR[i] = mapR[i] / 255;
      bufferG[i] = mapG[i] / 255;
      bufferB[i] = mapB[i] / 255;
    }
    return [bufferR.join(","), bufferG.join(","), bufferB.join(",")];
  }
  #createUrl(id) {
    if (this.#baseUrl === void 0) {
      this.#baseUrl = "";
      const url = this.#document.URL;
      if (url !== this.#document.baseURI) {
        if (isDataScheme(url)) {
          warn('#createUrl: ignore "data:"-URL for performance reasons.');
        } else {
          this.#baseUrl = url.split("#", 1)[0];
        }
      }
    }
    return `url(${this.#baseUrl}#${id})`;
  }
  addFilter(maps) {
    if (!maps) {
      return "none";
    }
    let value = this.#cache.get(maps);
    if (value) {
      return value;
    }
    const [tableR, tableG, tableB] = this.#createTables(maps);
    const key = maps.length === 1 ? tableR : `${tableR}${tableG}${tableB}`;
    value = this.#cache.get(key);
    if (value) {
      this.#cache.set(maps, value);
      return value;
    }
    const id = `g_${this.#docId}_transfer_map_${this.#id++}`;
    const url = this.#createUrl(id);
    this.#cache.set(maps, url);
    this.#cache.set(key, url);
    const filter = this.#createFilter(id);
    this.#addTransferMapConversion(tableR, tableG, tableB, filter);
    return url;
  }
  addHCMFilter(fgColor, bgColor) {
    const key = `${fgColor}-${bgColor}`;
    const filterName = "base";
    let info2 = this.#hcmCache.get(filterName);
    if (info2?.key === key) {
      return info2.url;
    }
    if (info2) {
      info2.filter?.remove();
      info2.key = key;
      info2.url = "none";
      info2.filter = null;
    } else {
      info2 = {
        key,
        url: "none",
        filter: null
      };
      this.#hcmCache.set(filterName, info2);
    }
    if (!fgColor || !bgColor) {
      return info2.url;
    }
    const fgRGB = this.#getRGB(fgColor);
    fgColor = Util.makeHexColor(...fgRGB);
    const bgRGB = this.#getRGB(bgColor);
    bgColor = Util.makeHexColor(...bgRGB);
    this.#defs.style.color = "";
    if (fgColor === "#000000" && bgColor === "#ffffff" || fgColor === bgColor) {
      return info2.url;
    }
    const map = new Array(256);
    for (let i = 0; i <= 255; i++) {
      const x = i / 255;
      map[i] = x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    }
    const table = map.join(",");
    const id = `g_${this.#docId}_hcm_filter`;
    const filter = info2.filter = this.#createFilter(id);
    this.#addTransferMapConversion(table, table, table, filter);
    this.#addGrayConversion(filter);
    const getSteps = (c, n) => {
      const start = fgRGB[c] / 255;
      const end = bgRGB[c] / 255;
      const arr = new Array(n + 1);
      for (let i = 0; i <= n; i++) {
        arr[i] = start + i / n * (end - start);
      }
      return arr.join(",");
    };
    this.#addTransferMapConversion(getSteps(0, 5), getSteps(1, 5), getSteps(2, 5), filter);
    info2.url = this.#createUrl(id);
    return info2.url;
  }
  addAlphaFilter(map) {
    let value = this.#cache.get(map);
    if (value) {
      return value;
    }
    const [tableA] = this.#createTables([map]);
    const key = `alpha_${tableA}`;
    value = this.#cache.get(key);
    if (value) {
      this.#cache.set(map, value);
      return value;
    }
    const id = `g_${this.#docId}_alpha_map_${this.#id++}`;
    const url = this.#createUrl(id);
    this.#cache.set(map, url);
    this.#cache.set(key, url);
    const filter = this.#createFilter(id);
    this.#addTransferMapAlphaConversion(tableA, filter);
    return url;
  }
  addLuminosityFilter(map) {
    let value = this.#cache.get(map || "luminosity");
    if (value) {
      return value;
    }
    let tableA, key;
    if (map) {
      [tableA] = this.#createTables([map]);
      key = `luminosity_${tableA}`;
    } else {
      key = "luminosity";
    }
    value = this.#cache.get(key);
    if (value) {
      this.#cache.set(map, value);
      return value;
    }
    const id = `g_${this.#docId}_luminosity_map_${this.#id++}`;
    const url = this.#createUrl(id);
    this.#cache.set(map, url);
    this.#cache.set(key, url);
    const filter = this.#createFilter(id);
    this.#addLuminosityConversion(filter);
    if (map) {
      this.#addTransferMapAlphaConversion(tableA, filter);
    }
    return url;
  }
  addHighlightHCMFilter(filterName, fgColor, bgColor, newFgColor, newBgColor) {
    const key = `${fgColor}-${bgColor}-${newFgColor}-${newBgColor}`;
    let info2 = this.#hcmCache.get(filterName);
    if (info2?.key === key) {
      return info2.url;
    }
    if (info2) {
      info2.filter?.remove();
      info2.key = key;
      info2.url = "none";
      info2.filter = null;
    } else {
      info2 = {
        key,
        url: "none",
        filter: null
      };
      this.#hcmCache.set(filterName, info2);
    }
    if (!fgColor || !bgColor) {
      return info2.url;
    }
    const [fgRGB, bgRGB] = [fgColor, bgColor].map(this.#getRGB.bind(this));
    let fgGray = Math.round(0.2126 * fgRGB[0] + 0.7152 * fgRGB[1] + 0.0722 * fgRGB[2]);
    let bgGray = Math.round(0.2126 * bgRGB[0] + 0.7152 * bgRGB[1] + 0.0722 * bgRGB[2]);
    let [newFgRGB, newBgRGB] = [newFgColor, newBgColor].map(this.#getRGB.bind(this));
    if (bgGray < fgGray) {
      [fgGray, bgGray, newFgRGB, newBgRGB] = [bgGray, fgGray, newBgRGB, newFgRGB];
    }
    this.#defs.style.color = "";
    const getSteps = (fg, bg, n) => {
      const arr = new Array(256);
      const step = (bgGray - fgGray) / n;
      const newStart = fg / 255;
      const newStep = (bg - fg) / (255 * n);
      let prev = 0;
      for (let i = 0; i <= n; i++) {
        const k = Math.round(fgGray + i * step);
        const value = newStart + i * newStep;
        for (let j = prev; j <= k; j++) {
          arr[j] = value;
        }
        prev = k + 1;
      }
      for (let i = prev; i < 256; i++) {
        arr[i] = arr[prev - 1];
      }
      return arr.join(",");
    };
    const id = `g_${this.#docId}_hcm_${filterName}_filter`;
    const filter = info2.filter = this.#createFilter(id);
    this.#addGrayConversion(filter);
    this.#addTransferMapConversion(getSteps(newFgRGB[0], newBgRGB[0], 5), getSteps(newFgRGB[1], newBgRGB[1], 5), getSteps(newFgRGB[2], newBgRGB[2], 5), filter);
    info2.url = this.#createUrl(id);
    return info2.url;
  }
  destroy(keepHCM = false) {
    if (keepHCM && this.#_hcmCache?.size) {
      return;
    }
    this.#_defs?.parentNode.parentNode.remove();
    this.#_defs = null;
    this.#_cache?.clear();
    this.#_cache = null;
    this.#_hcmCache?.clear();
    this.#_hcmCache = null;
    this.#id = 0;
  }
  #addLuminosityConversion(filter) {
    const feColorMatrix = this.#document.createElementNS(SVG_NS, "feColorMatrix");
    feColorMatrix.setAttribute("type", "matrix");
    feColorMatrix.setAttribute("values", "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0.59 0.11 0 0");
    filter.append(feColorMatrix);
  }
  #addGrayConversion(filter) {
    const feColorMatrix = this.#document.createElementNS(SVG_NS, "feColorMatrix");
    feColorMatrix.setAttribute("type", "matrix");
    feColorMatrix.setAttribute("values", "0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0");
    filter.append(feColorMatrix);
  }
  #createFilter(id) {
    const filter = this.#document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.setAttribute("id", id);
    this.#defs.append(filter);
    return filter;
  }
  #appendFeFunc(feComponentTransfer, func, table) {
    const feFunc = this.#document.createElementNS(SVG_NS, func);
    feFunc.setAttribute("type", "discrete");
    feFunc.setAttribute("tableValues", table);
    feComponentTransfer.append(feFunc);
  }
  #addTransferMapConversion(rTable, gTable, bTable, filter) {
    const feComponentTransfer = this.#document.createElementNS(SVG_NS, "feComponentTransfer");
    filter.append(feComponentTransfer);
    this.#appendFeFunc(feComponentTransfer, "feFuncR", rTable);
    this.#appendFeFunc(feComponentTransfer, "feFuncG", gTable);
    this.#appendFeFunc(feComponentTransfer, "feFuncB", bTable);
  }
  #addTransferMapAlphaConversion(aTable, filter) {
    const feComponentTransfer = this.#document.createElementNS(SVG_NS, "feComponentTransfer");
    filter.append(feComponentTransfer);
    this.#appendFeFunc(feComponentTransfer, "feFuncA", aTable);
  }
  #getRGB(color) {
    this.#defs.style.color = color;
    return getRGB(getComputedStyle(this.#defs).getPropertyValue("color"));
  }
};
var BaseStandardFontDataFactory = class {
  constructor({
    baseUrl = null
  }) {
    this.baseUrl = baseUrl;
  }
  async fetch({
    filename
  }) {
    if (!this.baseUrl) {
      throw new Error("Ensure that the `standardFontDataUrl` API parameter is provided.");
    }
    if (!filename) {
      throw new Error("Font filename must be specified.");
    }
    const url = `${this.baseUrl}${filename}`;
    return this._fetch(url).catch((reason) => {
      throw new Error(`Unable to load font data at: ${url}`);
    });
  }
  async _fetch(url) {
    unreachable("Abstract method `_fetch` called.");
  }
};
var DOMStandardFontDataFactory = class extends BaseStandardFontDataFactory {
  async _fetch(url) {
    const data = await fetchData(url, "arraybuffer");
    return new Uint8Array(data);
  }
};
if (isNodeJS) {
  let canvas;
  try {
    const require2 = process.getBuiltinModule("module").createRequire(import.meta.url);
    try {
      canvas = require2("@napi-rs/canvas");
    } catch (ex) {
      warn(`Cannot load "@napi-rs/canvas" package: "${ex}".`);
    }
  } catch (ex) {
    warn(`Cannot access the \`require\` function: "${ex}".`);
  }
  if (!globalThis.DOMMatrix) {
    if (canvas?.DOMMatrix) {
      globalThis.DOMMatrix = canvas.DOMMatrix;
    } else {
      warn("Cannot polyfill `DOMMatrix`, rendering may be broken.");
    }
  }
  if (!globalThis.ImageData) {
    if (canvas?.ImageData) {
      globalThis.ImageData = canvas.ImageData;
    } else {
      warn("Cannot polyfill `ImageData`, rendering may be broken.");
    }
  }
  if (!globalThis.Path2D) {
    if (canvas?.Path2D) {
      globalThis.Path2D = canvas.Path2D;
    } else {
      warn("Cannot polyfill `Path2D`, rendering may be broken.");
    }
  }
}
async function node_utils_fetchData(url) {
  const fs = process.getBuiltinModule("fs");
  const data = await fs.promises.readFile(url);
  return new Uint8Array(data);
}
var NodeFilterFactory = class extends BaseFilterFactory {
};
var NodeCanvasFactory = class extends BaseCanvasFactory {
  _createCanvas(width, height) {
    const require2 = process.getBuiltinModule("module").createRequire(import.meta.url);
    const canvas = require2("@napi-rs/canvas");
    return canvas.createCanvas(width, height);
  }
};
var NodeCMapReaderFactory = class extends BaseCMapReaderFactory {
  async _fetch(url) {
    return node_utils_fetchData(url);
  }
};
var NodeStandardFontDataFactory = class extends BaseStandardFontDataFactory {
  async _fetch(url) {
    return node_utils_fetchData(url);
  }
};
var PathType = {
  FILL: "Fill",
  STROKE: "Stroke",
  SHADING: "Shading"
};
function applyBoundingBox(ctx, bbox) {
  if (!bbox) {
    return;
  }
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const region = new Path2D();
  region.rect(bbox[0], bbox[1], width, height);
  ctx.clip(region);
}
var BaseShadingPattern = class {
  getPattern() {
    unreachable("Abstract method `getPattern` called.");
  }
};
var RadialAxialShadingPattern = class extends BaseShadingPattern {
  constructor(IR) {
    super();
    this._type = IR[1];
    this._bbox = IR[2];
    this._colorStops = IR[3];
    this._p0 = IR[4];
    this._p1 = IR[5];
    this._r0 = IR[6];
    this._r1 = IR[7];
    this.matrix = null;
  }
  _createGradient(ctx) {
    let grad;
    if (this._type === "axial") {
      grad = ctx.createLinearGradient(this._p0[0], this._p0[1], this._p1[0], this._p1[1]);
    } else if (this._type === "radial") {
      grad = ctx.createRadialGradient(this._p0[0], this._p0[1], this._r0, this._p1[0], this._p1[1], this._r1);
    }
    for (const colorStop of this._colorStops) {
      grad.addColorStop(colorStop[0], colorStop[1]);
    }
    return grad;
  }
  getPattern(ctx, owner, inverse, pathType) {
    let pattern;
    if (pathType === PathType.STROKE || pathType === PathType.FILL) {
      const ownerBBox = owner.current.getClippedPathBoundingBox(pathType, getCurrentTransform(ctx)) || [0, 0, 0, 0];
      const width = Math.ceil(ownerBBox[2] - ownerBBox[0]) || 1;
      const height = Math.ceil(ownerBBox[3] - ownerBBox[1]) || 1;
      const tmpCanvas = owner.cachedCanvases.getCanvas("pattern", width, height);
      const tmpCtx = tmpCanvas.context;
      tmpCtx.clearRect(0, 0, tmpCtx.canvas.width, tmpCtx.canvas.height);
      tmpCtx.beginPath();
      tmpCtx.rect(0, 0, tmpCtx.canvas.width, tmpCtx.canvas.height);
      tmpCtx.translate(-ownerBBox[0], -ownerBBox[1]);
      inverse = Util.transform(inverse, [1, 0, 0, 1, ownerBBox[0], ownerBBox[1]]);
      tmpCtx.transform(...owner.baseTransform);
      if (this.matrix) {
        tmpCtx.transform(...this.matrix);
      }
      applyBoundingBox(tmpCtx, this._bbox);
      tmpCtx.fillStyle = this._createGradient(tmpCtx);
      tmpCtx.fill();
      pattern = ctx.createPattern(tmpCanvas.canvas, "no-repeat");
      const domMatrix = new DOMMatrix(inverse);
      pattern.setTransform(domMatrix);
    } else {
      applyBoundingBox(ctx, this._bbox);
      pattern = this._createGradient(ctx);
    }
    return pattern;
  }
};
function drawTriangle(data, context, p1, p2, p3, c1, c2, c3) {
  const coords = context.coords, colors = context.colors;
  const bytes = data.data, rowSize = data.width * 4;
  let tmp;
  if (coords[p1 + 1] > coords[p2 + 1]) {
    tmp = p1;
    p1 = p2;
    p2 = tmp;
    tmp = c1;
    c1 = c2;
    c2 = tmp;
  }
  if (coords[p2 + 1] > coords[p3 + 1]) {
    tmp = p2;
    p2 = p3;
    p3 = tmp;
    tmp = c2;
    c2 = c3;
    c3 = tmp;
  }
  if (coords[p1 + 1] > coords[p2 + 1]) {
    tmp = p1;
    p1 = p2;
    p2 = tmp;
    tmp = c1;
    c1 = c2;
    c2 = tmp;
  }
  const x1 = (coords[p1] + context.offsetX) * context.scaleX;
  const y1 = (coords[p1 + 1] + context.offsetY) * context.scaleY;
  const x2 = (coords[p2] + context.offsetX) * context.scaleX;
  const y2 = (coords[p2 + 1] + context.offsetY) * context.scaleY;
  const x3 = (coords[p3] + context.offsetX) * context.scaleX;
  const y3 = (coords[p3 + 1] + context.offsetY) * context.scaleY;
  if (y1 >= y3) {
    return;
  }
  const c1r = colors[c1], c1g = colors[c1 + 1], c1b = colors[c1 + 2];
  const c2r = colors[c2], c2g = colors[c2 + 1], c2b = colors[c2 + 2];
  const c3r = colors[c3], c3g = colors[c3 + 1], c3b = colors[c3 + 2];
  const minY = Math.round(y1), maxY = Math.round(y3);
  let xa, car, cag, cab;
  let xb, cbr, cbg, cbb;
  for (let y = minY; y <= maxY; y++) {
    if (y < y2) {
      const k2 = y < y1 ? 0 : (y1 - y) / (y1 - y2);
      xa = x1 - (x1 - x2) * k2;
      car = c1r - (c1r - c2r) * k2;
      cag = c1g - (c1g - c2g) * k2;
      cab = c1b - (c1b - c2b) * k2;
    } else {
      let k2;
      if (y > y3) {
        k2 = 1;
      } else if (y2 === y3) {
        k2 = 0;
      } else {
        k2 = (y2 - y) / (y2 - y3);
      }
      xa = x2 - (x2 - x3) * k2;
      car = c2r - (c2r - c3r) * k2;
      cag = c2g - (c2g - c3g) * k2;
      cab = c2b - (c2b - c3b) * k2;
    }
    let k;
    if (y < y1) {
      k = 0;
    } else if (y > y3) {
      k = 1;
    } else {
      k = (y1 - y) / (y1 - y3);
    }
    xb = x1 - (x1 - x3) * k;
    cbr = c1r - (c1r - c3r) * k;
    cbg = c1g - (c1g - c3g) * k;
    cbb = c1b - (c1b - c3b) * k;
    const x1_ = Math.round(Math.min(xa, xb));
    const x2_ = Math.round(Math.max(xa, xb));
    let j = rowSize * y + x1_ * 4;
    for (let x = x1_; x <= x2_; x++) {
      k = (xa - x) / (xa - xb);
      if (k < 0) {
        k = 0;
      } else if (k > 1) {
        k = 1;
      }
      bytes[j++] = car - (car - cbr) * k | 0;
      bytes[j++] = cag - (cag - cbg) * k | 0;
      bytes[j++] = cab - (cab - cbb) * k | 0;
      bytes[j++] = 255;
    }
  }
}
function drawFigure(data, figure, context) {
  const ps = figure.coords;
  const cs = figure.colors;
  let i, ii;
  switch (figure.type) {
    case "lattice":
      const verticesPerRow = figure.verticesPerRow;
      const rows = Math.floor(ps.length / verticesPerRow) - 1;
      const cols = verticesPerRow - 1;
      for (i = 0; i < rows; i++) {
        let q = i * verticesPerRow;
        for (let j = 0; j < cols; j++, q++) {
          drawTriangle(data, context, ps[q], ps[q + 1], ps[q + verticesPerRow], cs[q], cs[q + 1], cs[q + verticesPerRow]);
          drawTriangle(data, context, ps[q + verticesPerRow + 1], ps[q + 1], ps[q + verticesPerRow], cs[q + verticesPerRow + 1], cs[q + 1], cs[q + verticesPerRow]);
        }
      }
      break;
    case "triangles":
      for (i = 0, ii = ps.length; i < ii; i += 3) {
        drawTriangle(data, context, ps[i], ps[i + 1], ps[i + 2], cs[i], cs[i + 1], cs[i + 2]);
      }
      break;
    default:
      throw new Error("illegal figure");
  }
}
var MeshShadingPattern = class extends BaseShadingPattern {
  constructor(IR) {
    super();
    this._coords = IR[2];
    this._colors = IR[3];
    this._figures = IR[4];
    this._bounds = IR[5];
    this._bbox = IR[7];
    this._background = IR[8];
    this.matrix = null;
  }
  _createMeshCanvas(combinedScale, backgroundColor, cachedCanvases) {
    const EXPECTED_SCALE = 1.1;
    const MAX_PATTERN_SIZE = 3e3;
    const BORDER_SIZE = 2;
    const offsetX = Math.floor(this._bounds[0]);
    const offsetY = Math.floor(this._bounds[1]);
    const boundsWidth = Math.ceil(this._bounds[2]) - offsetX;
    const boundsHeight = Math.ceil(this._bounds[3]) - offsetY;
    const width = Math.min(Math.ceil(Math.abs(boundsWidth * combinedScale[0] * EXPECTED_SCALE)), MAX_PATTERN_SIZE);
    const height = Math.min(Math.ceil(Math.abs(boundsHeight * combinedScale[1] * EXPECTED_SCALE)), MAX_PATTERN_SIZE);
    const scaleX = boundsWidth / width;
    const scaleY = boundsHeight / height;
    const context = {
      coords: this._coords,
      colors: this._colors,
      offsetX: -offsetX,
      offsetY: -offsetY,
      scaleX: 1 / scaleX,
      scaleY: 1 / scaleY
    };
    const paddedWidth = width + BORDER_SIZE * 2;
    const paddedHeight = height + BORDER_SIZE * 2;
    const tmpCanvas = cachedCanvases.getCanvas("mesh", paddedWidth, paddedHeight);
    const tmpCtx = tmpCanvas.context;
    const data = tmpCtx.createImageData(width, height);
    if (backgroundColor) {
      const bytes = data.data;
      for (let i = 0, ii = bytes.length; i < ii; i += 4) {
        bytes[i] = backgroundColor[0];
        bytes[i + 1] = backgroundColor[1];
        bytes[i + 2] = backgroundColor[2];
        bytes[i + 3] = 255;
      }
    }
    for (const figure of this._figures) {
      drawFigure(data, figure, context);
    }
    tmpCtx.putImageData(data, BORDER_SIZE, BORDER_SIZE);
    const canvas = tmpCanvas.canvas;
    return {
      canvas,
      offsetX: offsetX - BORDER_SIZE * scaleX,
      offsetY: offsetY - BORDER_SIZE * scaleY,
      scaleX,
      scaleY
    };
  }
  getPattern(ctx, owner, inverse, pathType) {
    applyBoundingBox(ctx, this._bbox);
    let scale;
    if (pathType === PathType.SHADING) {
      scale = Util.singularValueDecompose2dScale(getCurrentTransform(ctx));
    } else {
      scale = Util.singularValueDecompose2dScale(owner.baseTransform);
      if (this.matrix) {
        const matrixScale = Util.singularValueDecompose2dScale(this.matrix);
        scale = [scale[0] * matrixScale[0], scale[1] * matrixScale[1]];
      }
    }
    const temporaryPatternCanvas = this._createMeshCanvas(scale, pathType === PathType.SHADING ? null : this._background, owner.cachedCanvases);
    if (pathType !== PathType.SHADING) {
      ctx.setTransform(...owner.baseTransform);
      if (this.matrix) {
        ctx.transform(...this.matrix);
      }
    }
    ctx.translate(temporaryPatternCanvas.offsetX, temporaryPatternCanvas.offsetY);
    ctx.scale(temporaryPatternCanvas.scaleX, temporaryPatternCanvas.scaleY);
    return ctx.createPattern(temporaryPatternCanvas.canvas, "no-repeat");
  }
};
var DummyShadingPattern = class extends BaseShadingPattern {
  getPattern() {
    return "hotpink";
  }
};
function getShadingPattern(IR) {
  switch (IR[0]) {
    case "RadialAxial":
      return new RadialAxialShadingPattern(IR);
    case "Mesh":
      return new MeshShadingPattern(IR);
    case "Dummy":
      return new DummyShadingPattern();
  }
  throw new Error(`Unknown IR type: ${IR[0]}`);
}
var PaintType = {
  COLORED: 1,
  UNCOLORED: 2
};
var TilingPattern = class _TilingPattern {
  static MAX_PATTERN_SIZE = 3e3;
  constructor(IR, color, ctx, canvasGraphicsFactory, baseTransform) {
    this.operatorList = IR[2];
    this.matrix = IR[3];
    this.bbox = IR[4];
    this.xstep = IR[5];
    this.ystep = IR[6];
    this.paintType = IR[7];
    this.tilingType = IR[8];
    this.color = color;
    this.ctx = ctx;
    this.canvasGraphicsFactory = canvasGraphicsFactory;
    this.baseTransform = baseTransform;
  }
  createPatternCanvas(owner) {
    const {
      bbox,
      operatorList,
      paintType,
      tilingType,
      color,
      canvasGraphicsFactory
    } = this;
    let {
      xstep,
      ystep
    } = this;
    xstep = Math.abs(xstep);
    ystep = Math.abs(ystep);
    info("TilingType: " + tilingType);
    const x0 = bbox[0], y0 = bbox[1], x1 = bbox[2], y1 = bbox[3];
    const width = x1 - x0;
    const height = y1 - y0;
    const matrixScale = Util.singularValueDecompose2dScale(this.matrix);
    const curMatrixScale = Util.singularValueDecompose2dScale(this.baseTransform);
    const combinedScaleX = matrixScale[0] * curMatrixScale[0];
    const combinedScaleY = matrixScale[1] * curMatrixScale[1];
    let canvasWidth = width, canvasHeight = height, redrawHorizontally = false, redrawVertically = false;
    const xScaledStep = Math.ceil(xstep * combinedScaleX);
    const yScaledStep = Math.ceil(ystep * combinedScaleY);
    const xScaledWidth = Math.ceil(width * combinedScaleX);
    const yScaledHeight = Math.ceil(height * combinedScaleY);
    if (xScaledStep >= xScaledWidth) {
      canvasWidth = xstep;
    } else {
      redrawHorizontally = true;
    }
    if (yScaledStep >= yScaledHeight) {
      canvasHeight = ystep;
    } else {
      redrawVertically = true;
    }
    const dimx = this.getSizeAndScale(canvasWidth, this.ctx.canvas.width, combinedScaleX);
    const dimy = this.getSizeAndScale(canvasHeight, this.ctx.canvas.height, combinedScaleY);
    const tmpCanvas = owner.cachedCanvases.getCanvas("pattern", dimx.size, dimy.size);
    const tmpCtx = tmpCanvas.context;
    const graphics = canvasGraphicsFactory.createCanvasGraphics(tmpCtx);
    graphics.groupLevel = owner.groupLevel;
    this.setFillAndStrokeStyleToContext(graphics, paintType, color);
    tmpCtx.translate(-dimx.scale * x0, -dimy.scale * y0);
    graphics.transform(dimx.scale, 0, 0, dimy.scale, 0, 0);
    tmpCtx.save();
    this.clipBbox(graphics, x0, y0, x1, y1);
    graphics.baseTransform = getCurrentTransform(graphics.ctx);
    graphics.executeOperatorList(operatorList);
    graphics.endDrawing();
    tmpCtx.restore();
    if (redrawHorizontally || redrawVertically) {
      const image = tmpCanvas.canvas;
      if (redrawHorizontally) {
        canvasWidth = xstep;
      }
      if (redrawVertically) {
        canvasHeight = ystep;
      }
      const dimx2 = this.getSizeAndScale(canvasWidth, this.ctx.canvas.width, combinedScaleX);
      const dimy2 = this.getSizeAndScale(canvasHeight, this.ctx.canvas.height, combinedScaleY);
      const xSize = dimx2.size;
      const ySize = dimy2.size;
      const tmpCanvas2 = owner.cachedCanvases.getCanvas("pattern-workaround", xSize, ySize);
      const tmpCtx2 = tmpCanvas2.context;
      const ii = redrawHorizontally ? Math.floor(width / xstep) : 0;
      const jj = redrawVertically ? Math.floor(height / ystep) : 0;
      for (let i = 0; i <= ii; i++) {
        for (let j = 0; j <= jj; j++) {
          tmpCtx2.drawImage(image, xSize * i, ySize * j, xSize, ySize, 0, 0, xSize, ySize);
        }
      }
      return {
        canvas: tmpCanvas2.canvas,
        scaleX: dimx2.scale,
        scaleY: dimy2.scale,
        offsetX: x0,
        offsetY: y0
      };
    }
    return {
      canvas: tmpCanvas.canvas,
      scaleX: dimx.scale,
      scaleY: dimy.scale,
      offsetX: x0,
      offsetY: y0
    };
  }
  getSizeAndScale(step, realOutputSize, scale) {
    const maxSize = Math.max(_TilingPattern.MAX_PATTERN_SIZE, realOutputSize);
    let size = Math.ceil(step * scale);
    if (size >= maxSize) {
      size = maxSize;
    } else {
      scale = size / step;
    }
    return {
      scale,
      size
    };
  }
  clipBbox(graphics, x0, y0, x1, y1) {
    const bboxWidth = x1 - x0;
    const bboxHeight = y1 - y0;
    graphics.ctx.rect(x0, y0, bboxWidth, bboxHeight);
    graphics.current.updateRectMinMax(getCurrentTransform(graphics.ctx), [x0, y0, x1, y1]);
    graphics.clip();
    graphics.endPath();
  }
  setFillAndStrokeStyleToContext(graphics, paintType, color) {
    const context = graphics.ctx, current = graphics.current;
    switch (paintType) {
      case PaintType.COLORED:
        const ctx = this.ctx;
        context.fillStyle = ctx.fillStyle;
        context.strokeStyle = ctx.strokeStyle;
        current.fillColor = ctx.fillStyle;
        current.strokeColor = ctx.strokeStyle;
        break;
      case PaintType.UNCOLORED:
        const cssColor = Util.makeHexColor(color[0], color[1], color[2]);
        context.fillStyle = cssColor;
        context.strokeStyle = cssColor;
        current.fillColor = cssColor;
        current.strokeColor = cssColor;
        break;
      default:
        throw new FormatError(`Unsupported paint type: ${paintType}`);
    }
  }
  getPattern(ctx, owner, inverse, pathType) {
    let matrix = inverse;
    if (pathType !== PathType.SHADING) {
      matrix = Util.transform(matrix, owner.baseTransform);
      if (this.matrix) {
        matrix = Util.transform(matrix, this.matrix);
      }
    }
    const temporaryPatternCanvas = this.createPatternCanvas(owner);
    let domMatrix = new DOMMatrix(matrix);
    domMatrix = domMatrix.translate(temporaryPatternCanvas.offsetX, temporaryPatternCanvas.offsetY);
    domMatrix = domMatrix.scale(1 / temporaryPatternCanvas.scaleX, 1 / temporaryPatternCanvas.scaleY);
    const pattern = ctx.createPattern(temporaryPatternCanvas.canvas, "repeat");
    pattern.setTransform(domMatrix);
    return pattern;
  }
};
function convertBlackAndWhiteToRGBA({
  src,
  srcPos = 0,
  dest,
  width,
  height,
  nonBlackColor = 4294967295,
  inverseDecode = false
}) {
  const black = util_FeatureTest.isLittleEndian ? 4278190080 : 255;
  const [zeroMapping, oneMapping] = inverseDecode ? [nonBlackColor, black] : [black, nonBlackColor];
  const widthInSource = width >> 3;
  const widthRemainder = width & 7;
  const srcLength = src.length;
  dest = new Uint32Array(dest.buffer);
  let destPos = 0;
  for (let i = 0; i < height; i++) {
    for (const max = srcPos + widthInSource; srcPos < max; srcPos++) {
      const elem2 = srcPos < srcLength ? src[srcPos] : 255;
      dest[destPos++] = elem2 & 128 ? oneMapping : zeroMapping;
      dest[destPos++] = elem2 & 64 ? oneMapping : zeroMapping;
      dest[destPos++] = elem2 & 32 ? oneMapping : zeroMapping;
      dest[destPos++] = elem2 & 16 ? oneMapping : zeroMapping;
      dest[destPos++] = elem2 & 8 ? oneMapping : zeroMapping;
      dest[destPos++] = elem2 & 4 ? oneMapping : zeroMapping;
      dest[destPos++] = elem2 & 2 ? oneMapping : zeroMapping;
      dest[destPos++] = elem2 & 1 ? oneMapping : zeroMapping;
    }
    if (widthRemainder === 0) {
      continue;
    }
    const elem = srcPos < srcLength ? src[srcPos++] : 255;
    for (let j = 0; j < widthRemainder; j++) {
      dest[destPos++] = elem & 1 << 7 - j ? oneMapping : zeroMapping;
    }
  }
  return {
    srcPos,
    destPos
  };
}
var MIN_FONT_SIZE = 16;
var MAX_FONT_SIZE = 100;
var EXECUTION_TIME = 15;
var EXECUTION_STEPS = 10;
var MAX_SIZE_TO_COMPILE = 1e3;
var FULL_CHUNK_HEIGHT = 16;
function mirrorContextOperations(ctx, destCtx) {
  if (ctx._removeMirroring) {
    throw new Error("Context is already forwarding operations.");
  }
  ctx.__originalSave = ctx.save;
  ctx.__originalRestore = ctx.restore;
  ctx.__originalRotate = ctx.rotate;
  ctx.__originalScale = ctx.scale;
  ctx.__originalTranslate = ctx.translate;
  ctx.__originalTransform = ctx.transform;
  ctx.__originalSetTransform = ctx.setTransform;
  ctx.__originalResetTransform = ctx.resetTransform;
  ctx.__originalClip = ctx.clip;
  ctx.__originalMoveTo = ctx.moveTo;
  ctx.__originalLineTo = ctx.lineTo;
  ctx.__originalBezierCurveTo = ctx.bezierCurveTo;
  ctx.__originalRect = ctx.rect;
  ctx.__originalClosePath = ctx.closePath;
  ctx.__originalBeginPath = ctx.beginPath;
  ctx._removeMirroring = () => {
    ctx.save = ctx.__originalSave;
    ctx.restore = ctx.__originalRestore;
    ctx.rotate = ctx.__originalRotate;
    ctx.scale = ctx.__originalScale;
    ctx.translate = ctx.__originalTranslate;
    ctx.transform = ctx.__originalTransform;
    ctx.setTransform = ctx.__originalSetTransform;
    ctx.resetTransform = ctx.__originalResetTransform;
    ctx.clip = ctx.__originalClip;
    ctx.moveTo = ctx.__originalMoveTo;
    ctx.lineTo = ctx.__originalLineTo;
    ctx.bezierCurveTo = ctx.__originalBezierCurveTo;
    ctx.rect = ctx.__originalRect;
    ctx.closePath = ctx.__originalClosePath;
    ctx.beginPath = ctx.__originalBeginPath;
    delete ctx._removeMirroring;
  };
  ctx.save = function ctxSave() {
    destCtx.save();
    this.__originalSave();
  };
  ctx.restore = function ctxRestore() {
    destCtx.restore();
    this.__originalRestore();
  };
  ctx.translate = function ctxTranslate(x, y) {
    destCtx.translate(x, y);
    this.__originalTranslate(x, y);
  };
  ctx.scale = function ctxScale(x, y) {
    destCtx.scale(x, y);
    this.__originalScale(x, y);
  };
  ctx.transform = function ctxTransform(a, b, c, d, e, f) {
    destCtx.transform(a, b, c, d, e, f);
    this.__originalTransform(a, b, c, d, e, f);
  };
  ctx.setTransform = function ctxSetTransform(a, b, c, d, e, f) {
    destCtx.setTransform(a, b, c, d, e, f);
    this.__originalSetTransform(a, b, c, d, e, f);
  };
  ctx.resetTransform = function ctxResetTransform() {
    destCtx.resetTransform();
    this.__originalResetTransform();
  };
  ctx.rotate = function ctxRotate(angle) {
    destCtx.rotate(angle);
    this.__originalRotate(angle);
  };
  ctx.clip = function ctxRotate(rule) {
    destCtx.clip(rule);
    this.__originalClip(rule);
  };
  ctx.moveTo = function(x, y) {
    destCtx.moveTo(x, y);
    this.__originalMoveTo(x, y);
  };
  ctx.lineTo = function(x, y) {
    destCtx.lineTo(x, y);
    this.__originalLineTo(x, y);
  };
  ctx.bezierCurveTo = function(cp1x, cp1y, cp2x, cp2y, x, y) {
    destCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
    this.__originalBezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
  };
  ctx.rect = function(x, y, width, height) {
    destCtx.rect(x, y, width, height);
    this.__originalRect(x, y, width, height);
  };
  ctx.closePath = function() {
    destCtx.closePath();
    this.__originalClosePath();
  };
  ctx.beginPath = function() {
    destCtx.beginPath();
    this.__originalBeginPath();
  };
}
var CachedCanvases = class {
  constructor(canvasFactory) {
    this.canvasFactory = canvasFactory;
    this.cache = /* @__PURE__ */ Object.create(null);
  }
  getCanvas(id, width, height) {
    let canvasEntry;
    if (this.cache[id] !== void 0) {
      canvasEntry = this.cache[id];
      this.canvasFactory.reset(canvasEntry, width, height);
    } else {
      canvasEntry = this.canvasFactory.create(width, height);
      this.cache[id] = canvasEntry;
    }
    return canvasEntry;
  }
  delete(id) {
    delete this.cache[id];
  }
  clear() {
    for (const id in this.cache) {
      const canvasEntry = this.cache[id];
      this.canvasFactory.destroy(canvasEntry);
      delete this.cache[id];
    }
  }
};
function drawImageAtIntegerCoords(ctx, srcImg, srcX, srcY, srcW, srcH, destX, destY, destW, destH) {
  const [a, b, c, d, tx, ty] = getCurrentTransform(ctx);
  if (b === 0 && c === 0) {
    const tlX = destX * a + tx;
    const rTlX = Math.round(tlX);
    const tlY = destY * d + ty;
    const rTlY = Math.round(tlY);
    const brX = (destX + destW) * a + tx;
    const rWidth = Math.abs(Math.round(brX) - rTlX) || 1;
    const brY = (destY + destH) * d + ty;
    const rHeight = Math.abs(Math.round(brY) - rTlY) || 1;
    ctx.setTransform(Math.sign(a), 0, 0, Math.sign(d), rTlX, rTlY);
    ctx.drawImage(srcImg, srcX, srcY, srcW, srcH, 0, 0, rWidth, rHeight);
    ctx.setTransform(a, b, c, d, tx, ty);
    return [rWidth, rHeight];
  }
  if (a === 0 && d === 0) {
    const tlX = destY * c + tx;
    const rTlX = Math.round(tlX);
    const tlY = destX * b + ty;
    const rTlY = Math.round(tlY);
    const brX = (destY + destH) * c + tx;
    const rWidth = Math.abs(Math.round(brX) - rTlX) || 1;
    const brY = (destX + destW) * b + ty;
    const rHeight = Math.abs(Math.round(brY) - rTlY) || 1;
    ctx.setTransform(0, Math.sign(b), Math.sign(c), 0, rTlX, rTlY);
    ctx.drawImage(srcImg, srcX, srcY, srcW, srcH, 0, 0, rHeight, rWidth);
    ctx.setTransform(a, b, c, d, tx, ty);
    return [rHeight, rWidth];
  }
  ctx.drawImage(srcImg, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  return [scaleX * destW, scaleY * destH];
}
function compileType3Glyph(imgData) {
  const {
    width,
    height
  } = imgData;
  if (width > MAX_SIZE_TO_COMPILE || height > MAX_SIZE_TO_COMPILE) {
    return null;
  }
  const POINT_TO_PROCESS_LIMIT = 1e3;
  const POINT_TYPES = new Uint8Array([0, 2, 4, 0, 1, 0, 5, 4, 8, 10, 0, 8, 0, 2, 1, 0]);
  const width1 = width + 1;
  let points = new Uint8Array(width1 * (height + 1));
  let i, j, j0;
  const lineSize = width + 7 & ~7;
  let data = new Uint8Array(lineSize * height), pos = 0;
  for (const elem of imgData.data) {
    let mask = 128;
    while (mask > 0) {
      data[pos++] = elem & mask ? 0 : 255;
      mask >>= 1;
    }
  }
  let count = 0;
  pos = 0;
  if (data[pos] !== 0) {
    points[0] = 1;
    ++count;
  }
  for (j = 1; j < width; j++) {
    if (data[pos] !== data[pos + 1]) {
      points[j] = data[pos] ? 2 : 1;
      ++count;
    }
    pos++;
  }
  if (data[pos] !== 0) {
    points[j] = 2;
    ++count;
  }
  for (i = 1; i < height; i++) {
    pos = i * lineSize;
    j0 = i * width1;
    if (data[pos - lineSize] !== data[pos]) {
      points[j0] = data[pos] ? 1 : 8;
      ++count;
    }
    let sum = (data[pos] ? 4 : 0) + (data[pos - lineSize] ? 8 : 0);
    for (j = 1; j < width; j++) {
      sum = (sum >> 2) + (data[pos + 1] ? 4 : 0) + (data[pos - lineSize + 1] ? 8 : 0);
      if (POINT_TYPES[sum]) {
        points[j0 + j] = POINT_TYPES[sum];
        ++count;
      }
      pos++;
    }
    if (data[pos - lineSize] !== data[pos]) {
      points[j0 + j] = data[pos] ? 2 : 4;
      ++count;
    }
    if (count > POINT_TO_PROCESS_LIMIT) {
      return null;
    }
  }
  pos = lineSize * (height - 1);
  j0 = i * width1;
  if (data[pos] !== 0) {
    points[j0] = 8;
    ++count;
  }
  for (j = 1; j < width; j++) {
    if (data[pos] !== data[pos + 1]) {
      points[j0 + j] = data[pos] ? 4 : 8;
      ++count;
    }
    pos++;
  }
  if (data[pos] !== 0) {
    points[j0 + j] = 4;
    ++count;
  }
  if (count > POINT_TO_PROCESS_LIMIT) {
    return null;
  }
  const steps = new Int32Array([0, width1, -1, 0, -width1, 0, 0, 0, 1]);
  const path = new Path2D();
  for (i = 0; count && i <= height; i++) {
    let p = i * width1;
    const end = p + width;
    while (p < end && !points[p]) {
      p++;
    }
    if (p === end) {
      continue;
    }
    path.moveTo(p % width1, i);
    const p0 = p;
    let type = points[p];
    do {
      const step = steps[type];
      do {
        p += step;
      } while (!points[p]);
      const pp = points[p];
      if (pp !== 5 && pp !== 10) {
        type = pp;
        points[p] = 0;
      } else {
        type = pp & 51 * type >> 4;
        points[p] &= type >> 2 | type << 2;
      }
      path.lineTo(p % width1, p / width1 | 0);
      if (!points[p]) {
        --count;
      }
    } while (p0 !== p);
    --i;
  }
  data = null;
  points = null;
  const drawOutline = function(c) {
    c.save();
    c.scale(1 / width, -1 / height);
    c.translate(0, -height);
    c.fill(path);
    c.beginPath();
    c.restore();
  };
  return drawOutline;
}
var CanvasExtraState = class {
  constructor(width, height) {
    this.alphaIsShape = false;
    this.fontSize = 0;
    this.fontSizeScale = 1;
    this.textMatrix = IDENTITY_MATRIX;
    this.textMatrixScale = 1;
    this.fontMatrix = FONT_IDENTITY_MATRIX;
    this.leading = 0;
    this.x = 0;
    this.y = 0;
    this.lineX = 0;
    this.lineY = 0;
    this.charSpacing = 0;
    this.wordSpacing = 0;
    this.textHScale = 1;
    this.textRenderingMode = TextRenderingMode.FILL;
    this.textRise = 0;
    this.fillColor = "#000000";
    this.strokeColor = "#000000";
    this.patternFill = false;
    this.patternStroke = false;
    this.fillAlpha = 1;
    this.strokeAlpha = 1;
    this.lineWidth = 1;
    this.activeSMask = null;
    this.transferMaps = "none";
    this.startNewPathAndClipBox([0, 0, width, height]);
  }
  clone() {
    const clone = Object.create(this);
    clone.clipBox = this.clipBox.slice();
    return clone;
  }
  setCurrentPoint(x, y) {
    this.x = x;
    this.y = y;
  }
  updatePathMinMax(transform, x, y) {
    [x, y] = Util.applyTransform([x, y], transform);
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }
  updateRectMinMax(transform, rect) {
    const p1 = Util.applyTransform(rect, transform);
    const p2 = Util.applyTransform(rect.slice(2), transform);
    const p3 = Util.applyTransform([rect[0], rect[3]], transform);
    const p4 = Util.applyTransform([rect[2], rect[1]], transform);
    this.minX = Math.min(this.minX, p1[0], p2[0], p3[0], p4[0]);
    this.minY = Math.min(this.minY, p1[1], p2[1], p3[1], p4[1]);
    this.maxX = Math.max(this.maxX, p1[0], p2[0], p3[0], p4[0]);
    this.maxY = Math.max(this.maxY, p1[1], p2[1], p3[1], p4[1]);
  }
  updateScalingPathMinMax(transform, minMax) {
    Util.scaleMinMax(transform, minMax);
    this.minX = Math.min(this.minX, minMax[0]);
    this.minY = Math.min(this.minY, minMax[1]);
    this.maxX = Math.max(this.maxX, minMax[2]);
    this.maxY = Math.max(this.maxY, minMax[3]);
  }
  updateCurvePathMinMax(transform, x0, y0, x1, y1, x2, y2, x3, y3, minMax) {
    const box = Util.bezierBoundingBox(x0, y0, x1, y1, x2, y2, x3, y3, minMax);
    if (minMax) {
      return;
    }
    this.updateRectMinMax(transform, box);
  }
  getPathBoundingBox(pathType = PathType.FILL, transform = null) {
    const box = [this.minX, this.minY, this.maxX, this.maxY];
    if (pathType === PathType.STROKE) {
      if (!transform) {
        unreachable("Stroke bounding box must include transform.");
      }
      const scale = Util.singularValueDecompose2dScale(transform);
      const xStrokePad = scale[0] * this.lineWidth / 2;
      const yStrokePad = scale[1] * this.lineWidth / 2;
      box[0] -= xStrokePad;
      box[1] -= yStrokePad;
      box[2] += xStrokePad;
      box[3] += yStrokePad;
    }
    return box;
  }
  updateClipFromPath() {
    const intersect = Util.intersect(this.clipBox, this.getPathBoundingBox());
    this.startNewPathAndClipBox(intersect || [0, 0, 0, 0]);
  }
  isEmptyClip() {
    return this.minX === Infinity;
  }
  startNewPathAndClipBox(box) {
    this.clipBox = box;
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = 0;
    this.maxY = 0;
  }
  getClippedPathBoundingBox(pathType = PathType.FILL, transform = null) {
    return Util.intersect(this.clipBox, this.getPathBoundingBox(pathType, transform));
  }
};
function putBinaryImageData(ctx, imgData) {
  if (imgData instanceof ImageData) {
    ctx.putImageData(imgData, 0, 0);
    return;
  }
  const height = imgData.height, width = imgData.width;
  const partialChunkHeight = height % FULL_CHUNK_HEIGHT;
  const fullChunks = (height - partialChunkHeight) / FULL_CHUNK_HEIGHT;
  const totalChunks = partialChunkHeight === 0 ? fullChunks : fullChunks + 1;
  const chunkImgData = ctx.createImageData(width, FULL_CHUNK_HEIGHT);
  let srcPos = 0, destPos;
  const src = imgData.data;
  const dest = chunkImgData.data;
  let i, j, thisChunkHeight, elemsInThisChunk;
  if (imgData.kind === util_ImageKind.GRAYSCALE_1BPP) {
    const srcLength = src.byteLength;
    const dest32 = new Uint32Array(dest.buffer, 0, dest.byteLength >> 2);
    const dest32DataLength = dest32.length;
    const fullSrcDiff = width + 7 >> 3;
    const white = 4294967295;
    const black = util_FeatureTest.isLittleEndian ? 4278190080 : 255;
    for (i = 0; i < totalChunks; i++) {
      thisChunkHeight = i < fullChunks ? FULL_CHUNK_HEIGHT : partialChunkHeight;
      destPos = 0;
      for (j = 0; j < thisChunkHeight; j++) {
        const srcDiff = srcLength - srcPos;
        let k = 0;
        const kEnd = srcDiff > fullSrcDiff ? width : srcDiff * 8 - 7;
        const kEndUnrolled = kEnd & ~7;
        let mask = 0;
        let srcByte = 0;
        for (; k < kEndUnrolled; k += 8) {
          srcByte = src[srcPos++];
          dest32[destPos++] = srcByte & 128 ? white : black;
          dest32[destPos++] = srcByte & 64 ? white : black;
          dest32[destPos++] = srcByte & 32 ? white : black;
          dest32[destPos++] = srcByte & 16 ? white : black;
          dest32[destPos++] = srcByte & 8 ? white : black;
          dest32[destPos++] = srcByte & 4 ? white : black;
          dest32[destPos++] = srcByte & 2 ? white : black;
          dest32[destPos++] = srcByte & 1 ? white : black;
        }
        for (; k < kEnd; k++) {
          if (mask === 0) {
            srcByte = src[srcPos++];
            mask = 128;
          }
          dest32[destPos++] = srcByte & mask ? white : black;
          mask >>= 1;
        }
      }
      while (destPos < dest32DataLength) {
        dest32[destPos++] = 0;
      }
      ctx.putImageData(chunkImgData, 0, i * FULL_CHUNK_HEIGHT);
    }
  } else if (imgData.kind === util_ImageKind.RGBA_32BPP) {
    j = 0;
    elemsInThisChunk = width * FULL_CHUNK_HEIGHT * 4;
    for (i = 0; i < fullChunks; i++) {
      dest.set(src.subarray(srcPos, srcPos + elemsInThisChunk));
      srcPos += elemsInThisChunk;
      ctx.putImageData(chunkImgData, 0, j);
      j += FULL_CHUNK_HEIGHT;
    }
    if (i < totalChunks) {
      elemsInThisChunk = width * partialChunkHeight * 4;
      dest.set(src.subarray(srcPos, srcPos + elemsInThisChunk));
      ctx.putImageData(chunkImgData, 0, j);
    }
  } else if (imgData.kind === util_ImageKind.RGB_24BPP) {
    thisChunkHeight = FULL_CHUNK_HEIGHT;
    elemsInThisChunk = width * thisChunkHeight;
    for (i = 0; i < totalChunks; i++) {
      if (i >= fullChunks) {
        thisChunkHeight = partialChunkHeight;
        elemsInThisChunk = width * thisChunkHeight;
      }
      destPos = 0;
      for (j = elemsInThisChunk; j--; ) {
        dest[destPos++] = src[srcPos++];
        dest[destPos++] = src[srcPos++];
        dest[destPos++] = src[srcPos++];
        dest[destPos++] = 255;
      }
      ctx.putImageData(chunkImgData, 0, i * FULL_CHUNK_HEIGHT);
    }
  } else {
    throw new Error(`bad image kind: ${imgData.kind}`);
  }
}
function putBinaryImageMask(ctx, imgData) {
  if (imgData.bitmap) {
    ctx.drawImage(imgData.bitmap, 0, 0);
    return;
  }
  const height = imgData.height, width = imgData.width;
  const partialChunkHeight = height % FULL_CHUNK_HEIGHT;
  const fullChunks = (height - partialChunkHeight) / FULL_CHUNK_HEIGHT;
  const totalChunks = partialChunkHeight === 0 ? fullChunks : fullChunks + 1;
  const chunkImgData = ctx.createImageData(width, FULL_CHUNK_HEIGHT);
  let srcPos = 0;
  const src = imgData.data;
  const dest = chunkImgData.data;
  for (let i = 0; i < totalChunks; i++) {
    const thisChunkHeight = i < fullChunks ? FULL_CHUNK_HEIGHT : partialChunkHeight;
    ({
      srcPos
    } = convertBlackAndWhiteToRGBA({
      src,
      srcPos,
      dest,
      width,
      height: thisChunkHeight,
      nonBlackColor: 0
    }));
    ctx.putImageData(chunkImgData, 0, i * FULL_CHUNK_HEIGHT);
  }
}
function copyCtxState(sourceCtx, destCtx) {
  const properties = ["strokeStyle", "fillStyle", "fillRule", "globalAlpha", "lineWidth", "lineCap", "lineJoin", "miterLimit", "globalCompositeOperation", "font", "filter"];
  for (const property of properties) {
    if (sourceCtx[property] !== void 0) {
      destCtx[property] = sourceCtx[property];
    }
  }
  if (sourceCtx.setLineDash !== void 0) {
    destCtx.setLineDash(sourceCtx.getLineDash());
    destCtx.lineDashOffset = sourceCtx.lineDashOffset;
  }
}
function resetCtxToDefault(ctx) {
  ctx.strokeStyle = ctx.fillStyle = "#000000";
  ctx.fillRule = "nonzero";
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 10;
  ctx.globalCompositeOperation = "source-over";
  ctx.font = "10px sans-serif";
  if (ctx.setLineDash !== void 0) {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  if (!isNodeJS) {
    const {
      filter
    } = ctx;
    if (filter !== "none" && filter !== "") {
      ctx.filter = "none";
    }
  }
}
function getImageSmoothingEnabled(transform, interpolate) {
  if (interpolate) {
    return true;
  }
  const scale = Util.singularValueDecompose2dScale(transform);
  scale[0] = Math.fround(scale[0]);
  scale[1] = Math.fround(scale[1]);
  const actualScale = Math.fround((globalThis.devicePixelRatio || 1) * PixelsPerInch.PDF_TO_CSS_UNITS);
  return scale[0] <= actualScale && scale[1] <= actualScale;
}
var LINE_CAP_STYLES = ["butt", "round", "square"];
var LINE_JOIN_STYLES = ["miter", "round", "bevel"];
var NORMAL_CLIP = {};
var EO_CLIP = {};
var CanvasGraphics = class _CanvasGraphics {
  constructor(canvasCtx, commonObjs, objs, canvasFactory, filterFactory, {
    optionalContentConfig,
    markedContentStack = null
  }, annotationCanvasMap, pageColors) {
    this.ctx = canvasCtx;
    this.current = new CanvasExtraState(this.ctx.canvas.width, this.ctx.canvas.height);
    this.stateStack = [];
    this.pendingClip = null;
    this.pendingEOFill = false;
    this.res = null;
    this.xobjs = null;
    this.commonObjs = commonObjs;
    this.objs = objs;
    this.canvasFactory = canvasFactory;
    this.filterFactory = filterFactory;
    this.groupStack = [];
    this.processingType3 = null;
    this.baseTransform = null;
    this.baseTransformStack = [];
    this.groupLevel = 0;
    this.smaskStack = [];
    this.smaskCounter = 0;
    this.tempSMask = null;
    this.suspendedCtx = null;
    this.contentVisible = true;
    this.markedContentStack = markedContentStack || [];
    this.optionalContentConfig = optionalContentConfig;
    this.cachedCanvases = new CachedCanvases(this.canvasFactory);
    this.cachedPatterns = /* @__PURE__ */ new Map();
    this.annotationCanvasMap = annotationCanvasMap;
    this.viewportScale = 1;
    this.outputScaleX = 1;
    this.outputScaleY = 1;
    this.pageColors = pageColors;
    this._cachedScaleForStroking = [-1, 0];
    this._cachedGetSinglePixelWidth = null;
    this._cachedBitmapsMap = /* @__PURE__ */ new Map();
  }
  getObject(data, fallback = null) {
    if (typeof data === "string") {
      return data.startsWith("g_") ? this.commonObjs.get(data) : this.objs.get(data);
    }
    return fallback;
  }
  beginDrawing({
    transform,
    viewport,
    transparency = false,
    background = null
  }) {
    const width = this.ctx.canvas.width;
    const height = this.ctx.canvas.height;
    const savedFillStyle = this.ctx.fillStyle;
    this.ctx.fillStyle = background || "#ffffff";
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.fillStyle = savedFillStyle;
    if (transparency) {
      const transparentCanvas = this.cachedCanvases.getCanvas("transparent", width, height);
      this.compositeCtx = this.ctx;
      this.transparentCanvas = transparentCanvas.canvas;
      this.ctx = transparentCanvas.context;
      this.ctx.save();
      this.ctx.transform(...getCurrentTransform(this.compositeCtx));
    }
    this.ctx.save();
    resetCtxToDefault(this.ctx);
    if (transform) {
      this.ctx.transform(...transform);
      this.outputScaleX = transform[0];
      this.outputScaleY = transform[0];
    }
    this.ctx.transform(...viewport.transform);
    this.viewportScale = viewport.scale;
    this.baseTransform = getCurrentTransform(this.ctx);
  }
  executeOperatorList(operatorList, executionStartIdx, continueCallback, stepper) {
    const argsArray = operatorList.argsArray;
    const fnArray = operatorList.fnArray;
    let i = executionStartIdx || 0;
    const argsArrayLen = argsArray.length;
    if (argsArrayLen === i) {
      return i;
    }
    const chunkOperations = argsArrayLen - i > EXECUTION_STEPS && typeof continueCallback === "function";
    const endTime = chunkOperations ? Date.now() + EXECUTION_TIME : 0;
    let steps = 0;
    const commonObjs = this.commonObjs;
    const objs = this.objs;
    let fnId;
    while (true) {
      if (stepper !== void 0 && i === stepper.nextBreakPoint) {
        stepper.breakIt(i, continueCallback);
        return i;
      }
      fnId = fnArray[i];
      if (fnId !== OPS.dependency) {
        this[fnId].apply(this, argsArray[i]);
      } else {
        for (const depObjId of argsArray[i]) {
          const objsPool = depObjId.startsWith("g_") ? commonObjs : objs;
          if (!objsPool.has(depObjId)) {
            objsPool.get(depObjId, continueCallback);
            return i;
          }
        }
      }
      i++;
      if (i === argsArrayLen) {
        return i;
      }
      if (chunkOperations && ++steps > EXECUTION_STEPS) {
        if (Date.now() > endTime) {
          continueCallback();
          return i;
        }
        steps = 0;
      }
    }
  }
  #restoreInitialState() {
    while (this.stateStack.length || this.inSMaskMode) {
      this.restore();
    }
    this.current.activeSMask = null;
    this.ctx.restore();
    if (this.transparentCanvas) {
      this.ctx = this.compositeCtx;
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(this.transparentCanvas, 0, 0);
      this.ctx.restore();
      this.transparentCanvas = null;
    }
  }
  endDrawing() {
    this.#restoreInitialState();
    this.cachedCanvases.clear();
    this.cachedPatterns.clear();
    for (const cache of this._cachedBitmapsMap.values()) {
      for (const canvas of cache.values()) {
        if (typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) {
          canvas.width = canvas.height = 0;
        }
      }
      cache.clear();
    }
    this._cachedBitmapsMap.clear();
    this.#drawFilter();
  }
  #drawFilter() {
    if (this.pageColors) {
      const hcmFilterId = this.filterFactory.addHCMFilter(this.pageColors.foreground, this.pageColors.background);
      if (hcmFilterId !== "none") {
        const savedFilter = this.ctx.filter;
        this.ctx.filter = hcmFilterId;
        this.ctx.drawImage(this.ctx.canvas, 0, 0);
        this.ctx.filter = savedFilter;
      }
    }
  }
  _scaleImage(img, inverseTransform) {
    const width = img.width ?? img.displayWidth;
    const height = img.height ?? img.displayHeight;
    let widthScale = Math.max(Math.hypot(inverseTransform[0], inverseTransform[1]), 1);
    let heightScale = Math.max(Math.hypot(inverseTransform[2], inverseTransform[3]), 1);
    let paintWidth = width, paintHeight = height;
    let tmpCanvasId = "prescale1";
    let tmpCanvas, tmpCtx;
    while (widthScale > 2 && paintWidth > 1 || heightScale > 2 && paintHeight > 1) {
      let newWidth = paintWidth, newHeight = paintHeight;
      if (widthScale > 2 && paintWidth > 1) {
        newWidth = paintWidth >= 16384 ? Math.floor(paintWidth / 2) - 1 || 1 : Math.ceil(paintWidth / 2);
        widthScale /= paintWidth / newWidth;
      }
      if (heightScale > 2 && paintHeight > 1) {
        newHeight = paintHeight >= 16384 ? Math.floor(paintHeight / 2) - 1 || 1 : Math.ceil(paintHeight) / 2;
        heightScale /= paintHeight / newHeight;
      }
      tmpCanvas = this.cachedCanvases.getCanvas(tmpCanvasId, newWidth, newHeight);
      tmpCtx = tmpCanvas.context;
      tmpCtx.clearRect(0, 0, newWidth, newHeight);
      tmpCtx.drawImage(img, 0, 0, paintWidth, paintHeight, 0, 0, newWidth, newHeight);
      img = tmpCanvas.canvas;
      paintWidth = newWidth;
      paintHeight = newHeight;
      tmpCanvasId = tmpCanvasId === "prescale1" ? "prescale2" : "prescale1";
    }
    return {
      img,
      paintWidth,
      paintHeight
    };
  }
  _createMaskCanvas(img) {
    const ctx = this.ctx;
    const {
      width,
      height
    } = img;
    const fillColor = this.current.fillColor;
    const isPatternFill = this.current.patternFill;
    const currentTransform = getCurrentTransform(ctx);
    let cache, cacheKey, scaled, maskCanvas;
    if ((img.bitmap || img.data) && img.count > 1) {
      const mainKey = img.bitmap || img.data.buffer;
      cacheKey = JSON.stringify(isPatternFill ? currentTransform : [currentTransform.slice(0, 4), fillColor]);
      cache = this._cachedBitmapsMap.get(mainKey);
      if (!cache) {
        cache = /* @__PURE__ */ new Map();
        this._cachedBitmapsMap.set(mainKey, cache);
      }
      const cachedImage = cache.get(cacheKey);
      if (cachedImage && !isPatternFill) {
        const offsetX2 = Math.round(Math.min(currentTransform[0], currentTransform[2]) + currentTransform[4]);
        const offsetY2 = Math.round(Math.min(currentTransform[1], currentTransform[3]) + currentTransform[5]);
        return {
          canvas: cachedImage,
          offsetX: offsetX2,
          offsetY: offsetY2
        };
      }
      scaled = cachedImage;
    }
    if (!scaled) {
      maskCanvas = this.cachedCanvases.getCanvas("maskCanvas", width, height);
      putBinaryImageMask(maskCanvas.context, img);
    }
    let maskToCanvas = Util.transform(currentTransform, [1 / width, 0, 0, -1 / height, 0, 0]);
    maskToCanvas = Util.transform(maskToCanvas, [1, 0, 0, 1, 0, -height]);
    const [minX, minY, maxX, maxY] = Util.getAxialAlignedBoundingBox([0, 0, width, height], maskToCanvas);
    const drawnWidth = Math.round(maxX - minX) || 1;
    const drawnHeight = Math.round(maxY - minY) || 1;
    const fillCanvas = this.cachedCanvases.getCanvas("fillCanvas", drawnWidth, drawnHeight);
    const fillCtx = fillCanvas.context;
    const offsetX = minX;
    const offsetY = minY;
    fillCtx.translate(-offsetX, -offsetY);
    fillCtx.transform(...maskToCanvas);
    if (!scaled) {
      scaled = this._scaleImage(maskCanvas.canvas, getCurrentTransformInverse(fillCtx));
      scaled = scaled.img;
      if (cache && isPatternFill) {
        cache.set(cacheKey, scaled);
      }
    }
    fillCtx.imageSmoothingEnabled = getImageSmoothingEnabled(getCurrentTransform(fillCtx), img.interpolate);
    drawImageAtIntegerCoords(fillCtx, scaled, 0, 0, scaled.width, scaled.height, 0, 0, width, height);
    fillCtx.globalCompositeOperation = "source-in";
    const inverse = Util.transform(getCurrentTransformInverse(fillCtx), [1, 0, 0, 1, -offsetX, -offsetY]);
    fillCtx.fillStyle = isPatternFill ? fillColor.getPattern(ctx, this, inverse, PathType.FILL) : fillColor;
    fillCtx.fillRect(0, 0, width, height);
    if (cache && !isPatternFill) {
      this.cachedCanvases.delete("fillCanvas");
      cache.set(cacheKey, fillCanvas.canvas);
    }
    return {
      canvas: fillCanvas.canvas,
      offsetX: Math.round(offsetX),
      offsetY: Math.round(offsetY)
    };
  }
  setLineWidth(width) {
    if (width !== this.current.lineWidth) {
      this._cachedScaleForStroking[0] = -1;
    }
    this.current.lineWidth = width;
    this.ctx.lineWidth = width;
  }
  setLineCap(style) {
    this.ctx.lineCap = LINE_CAP_STYLES[style];
  }
  setLineJoin(style) {
    this.ctx.lineJoin = LINE_JOIN_STYLES[style];
  }
  setMiterLimit(limit) {
    this.ctx.miterLimit = limit;
  }
  setDash(dashArray, dashPhase) {
    const ctx = this.ctx;
    if (ctx.setLineDash !== void 0) {
      ctx.setLineDash(dashArray);
      ctx.lineDashOffset = dashPhase;
    }
  }
  setRenderingIntent(intent) {
  }
  setFlatness(flatness) {
  }
  setGState(states) {
    for (const [key, value] of states) {
      switch (key) {
        case "LW":
          this.setLineWidth(value);
          break;
        case "LC":
          this.setLineCap(value);
          break;
        case "LJ":
          this.setLineJoin(value);
          break;
        case "ML":
          this.setMiterLimit(value);
          break;
        case "D":
          this.setDash(value[0], value[1]);
          break;
        case "RI":
          this.setRenderingIntent(value);
          break;
        case "FL":
          this.setFlatness(value);
          break;
        case "Font":
          this.setFont(value[0], value[1]);
          break;
        case "CA":
          this.current.strokeAlpha = value;
          break;
        case "ca":
          this.current.fillAlpha = value;
          this.ctx.globalAlpha = value;
          break;
        case "BM":
          this.ctx.globalCompositeOperation = value;
          break;
        case "SMask":
          this.current.activeSMask = value ? this.tempSMask : null;
          this.tempSMask = null;
          this.checkSMaskState();
          break;
        case "TR":
          this.ctx.filter = this.current.transferMaps = this.filterFactory.addFilter(value);
          break;
      }
    }
  }
  get inSMaskMode() {
    return !!this.suspendedCtx;
  }
  checkSMaskState() {
    const inSMaskMode = this.inSMaskMode;
    if (this.current.activeSMask && !inSMaskMode) {
      this.beginSMaskMode();
    } else if (!this.current.activeSMask && inSMaskMode) {
      this.endSMaskMode();
    }
  }
  beginSMaskMode() {
    if (this.inSMaskMode) {
      throw new Error("beginSMaskMode called while already in smask mode");
    }
    const drawnWidth = this.ctx.canvas.width;
    const drawnHeight = this.ctx.canvas.height;
    const cacheId = "smaskGroupAt" + this.groupLevel;
    const scratchCanvas = this.cachedCanvases.getCanvas(cacheId, drawnWidth, drawnHeight);
    this.suspendedCtx = this.ctx;
    this.ctx = scratchCanvas.context;
    const ctx = this.ctx;
    ctx.setTransform(...getCurrentTransform(this.suspendedCtx));
    copyCtxState(this.suspendedCtx, ctx);
    mirrorContextOperations(ctx, this.suspendedCtx);
    this.setGState([["BM", "source-over"], ["ca", 1], ["CA", 1]]);
  }
  endSMaskMode() {
    if (!this.inSMaskMode) {
      throw new Error("endSMaskMode called while not in smask mode");
    }
    this.ctx._removeMirroring();
    copyCtxState(this.ctx, this.suspendedCtx);
    this.ctx = this.suspendedCtx;
    this.suspendedCtx = null;
  }
  compose(dirtyBox) {
    if (!this.current.activeSMask) {
      return;
    }
    if (!dirtyBox) {
      dirtyBox = [0, 0, this.ctx.canvas.width, this.ctx.canvas.height];
    } else {
      dirtyBox[0] = Math.floor(dirtyBox[0]);
      dirtyBox[1] = Math.floor(dirtyBox[1]);
      dirtyBox[2] = Math.ceil(dirtyBox[2]);
      dirtyBox[3] = Math.ceil(dirtyBox[3]);
    }
    const smask = this.current.activeSMask;
    const suspendedCtx = this.suspendedCtx;
    this.composeSMask(suspendedCtx, smask, this.ctx, dirtyBox);
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.ctx.restore();
  }
  composeSMask(ctx, smask, layerCtx, layerBox) {
    const layerOffsetX = layerBox[0];
    const layerOffsetY = layerBox[1];
    const layerWidth = layerBox[2] - layerOffsetX;
    const layerHeight = layerBox[3] - layerOffsetY;
    if (layerWidth === 0 || layerHeight === 0) {
      return;
    }
    this.genericComposeSMask(smask.context, layerCtx, layerWidth, layerHeight, smask.subtype, smask.backdrop, smask.transferMap, layerOffsetX, layerOffsetY, smask.offsetX, smask.offsetY);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layerCtx.canvas, 0, 0);
    ctx.restore();
  }
  genericComposeSMask(maskCtx, layerCtx, width, height, subtype, backdrop, transferMap, layerOffsetX, layerOffsetY, maskOffsetX, maskOffsetY) {
    let maskCanvas = maskCtx.canvas;
    let maskX = layerOffsetX - maskOffsetX;
    let maskY = layerOffsetY - maskOffsetY;
    if (backdrop) {
      const backdropRGB = Util.makeHexColor(...backdrop);
      if (maskX < 0 || maskY < 0 || maskX + width > maskCanvas.width || maskY + height > maskCanvas.height) {
        const canvas = this.cachedCanvases.getCanvas("maskExtension", width, height);
        const ctx = canvas.context;
        ctx.drawImage(maskCanvas, -maskX, -maskY);
        ctx.globalCompositeOperation = "destination-atop";
        ctx.fillStyle = backdropRGB;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";
        maskCanvas = canvas.canvas;
        maskX = maskY = 0;
      } else {
        maskCtx.save();
        maskCtx.globalAlpha = 1;
        maskCtx.setTransform(1, 0, 0, 1, 0, 0);
        const clip2 = new Path2D();
        clip2.rect(maskX, maskY, width, height);
        maskCtx.clip(clip2);
        maskCtx.globalCompositeOperation = "destination-atop";
        maskCtx.fillStyle = backdropRGB;
        maskCtx.fillRect(maskX, maskY, width, height);
        maskCtx.restore();
      }
    }
    layerCtx.save();
    layerCtx.globalAlpha = 1;
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    if (subtype === "Alpha" && transferMap) {
      layerCtx.filter = this.filterFactory.addAlphaFilter(transferMap);
    } else if (subtype === "Luminosity") {
      layerCtx.filter = this.filterFactory.addLuminosityFilter(transferMap);
    }
    const clip = new Path2D();
    clip.rect(layerOffsetX, layerOffsetY, width, height);
    layerCtx.clip(clip);
    layerCtx.globalCompositeOperation = "destination-in";
    layerCtx.drawImage(maskCanvas, maskX, maskY, width, height, layerOffsetX, layerOffsetY, width, height);
    layerCtx.restore();
  }
  save() {
    if (this.inSMaskMode) {
      copyCtxState(this.ctx, this.suspendedCtx);
      this.suspendedCtx.save();
    } else {
      this.ctx.save();
    }
    const old = this.current;
    this.stateStack.push(old);
    this.current = old.clone();
  }
  restore() {
    if (this.stateStack.length === 0 && this.inSMaskMode) {
      this.endSMaskMode();
    }
    if (this.stateStack.length !== 0) {
      this.current = this.stateStack.pop();
      if (this.inSMaskMode) {
        this.suspendedCtx.restore();
        copyCtxState(this.suspendedCtx, this.ctx);
      } else {
        this.ctx.restore();
      }
      this.checkSMaskState();
      this.pendingClip = null;
      this._cachedScaleForStroking[0] = -1;
      this._cachedGetSinglePixelWidth = null;
    }
  }
  transform(a, b, c, d, e, f) {
    this.ctx.transform(a, b, c, d, e, f);
    this._cachedScaleForStroking[0] = -1;
    this._cachedGetSinglePixelWidth = null;
  }
  constructPath(ops, args, minMax) {
    const ctx = this.ctx;
    const current = this.current;
    let x = current.x, y = current.y;
    let startX, startY;
    const currentTransform = getCurrentTransform(ctx);
    const isScalingMatrix = currentTransform[0] === 0 && currentTransform[3] === 0 || currentTransform[1] === 0 && currentTransform[2] === 0;
    const minMaxForBezier = isScalingMatrix ? minMax.slice(0) : null;
    for (let i = 0, j = 0, ii = ops.length; i < ii; i++) {
      switch (ops[i] | 0) {
        case OPS.rectangle:
          x = args[j++];
          y = args[j++];
          const width = args[j++];
          const height = args[j++];
          const xw = x + width;
          const yh = y + height;
          ctx.moveTo(x, y);
          if (width === 0 || height === 0) {
            ctx.lineTo(xw, yh);
          } else {
            ctx.lineTo(xw, y);
            ctx.lineTo(xw, yh);
            ctx.lineTo(x, yh);
          }
          if (!isScalingMatrix) {
            current.updateRectMinMax(currentTransform, [x, y, xw, yh]);
          }
          ctx.closePath();
          break;
        case OPS.moveTo:
          x = args[j++];
          y = args[j++];
          ctx.moveTo(x, y);
          if (!isScalingMatrix) {
            current.updatePathMinMax(currentTransform, x, y);
          }
          break;
        case OPS.lineTo:
          x = args[j++];
          y = args[j++];
          ctx.lineTo(x, y);
          if (!isScalingMatrix) {
            current.updatePathMinMax(currentTransform, x, y);
          }
          break;
        case OPS.curveTo:
          startX = x;
          startY = y;
          x = args[j + 4];
          y = args[j + 5];
          ctx.bezierCurveTo(args[j], args[j + 1], args[j + 2], args[j + 3], x, y);
          current.updateCurvePathMinMax(currentTransform, startX, startY, args[j], args[j + 1], args[j + 2], args[j + 3], x, y, minMaxForBezier);
          j += 6;
          break;
        case OPS.curveTo2:
          startX = x;
          startY = y;
          ctx.bezierCurveTo(x, y, args[j], args[j + 1], args[j + 2], args[j + 3]);
          current.updateCurvePathMinMax(currentTransform, startX, startY, x, y, args[j], args[j + 1], args[j + 2], args[j + 3], minMaxForBezier);
          x = args[j + 2];
          y = args[j + 3];
          j += 4;
          break;
        case OPS.curveTo3:
          startX = x;
          startY = y;
          x = args[j + 2];
          y = args[j + 3];
          ctx.bezierCurveTo(args[j], args[j + 1], x, y, x, y);
          current.updateCurvePathMinMax(currentTransform, startX, startY, args[j], args[j + 1], x, y, x, y, minMaxForBezier);
          j += 4;
          break;
        case OPS.closePath:
          ctx.closePath();
          break;
      }
    }
    if (isScalingMatrix) {
      current.updateScalingPathMinMax(currentTransform, minMaxForBezier);
    }
    current.setCurrentPoint(x, y);
  }
  closePath() {
    this.ctx.closePath();
  }
  stroke(consumePath = true) {
    const ctx = this.ctx;
    const strokeColor = this.current.strokeColor;
    ctx.globalAlpha = this.current.strokeAlpha;
    if (this.contentVisible) {
      if (typeof strokeColor === "object" && strokeColor?.getPattern) {
        ctx.save();
        ctx.strokeStyle = strokeColor.getPattern(ctx, this, getCurrentTransformInverse(ctx), PathType.STROKE);
        this.rescaleAndStroke(false);
        ctx.restore();
      } else {
        this.rescaleAndStroke(true);
      }
    }
    if (consumePath) {
      this.consumePath(this.current.getClippedPathBoundingBox());
    }
    ctx.globalAlpha = this.current.fillAlpha;
  }
  closeStroke() {
    this.closePath();
    this.stroke();
  }
  fill(consumePath = true) {
    const ctx = this.ctx;
    const fillColor = this.current.fillColor;
    const isPatternFill = this.current.patternFill;
    let needRestore = false;
    if (isPatternFill) {
      ctx.save();
      ctx.fillStyle = fillColor.getPattern(ctx, this, getCurrentTransformInverse(ctx), PathType.FILL);
      needRestore = true;
    }
    const intersect = this.current.getClippedPathBoundingBox();
    if (this.contentVisible && intersect !== null) {
      if (this.pendingEOFill) {
        ctx.fill("evenodd");
        this.pendingEOFill = false;
      } else {
        ctx.fill();
      }
    }
    if (needRestore) {
      ctx.restore();
    }
    if (consumePath) {
      this.consumePath(intersect);
    }
  }
  eoFill() {
    this.pendingEOFill = true;
    this.fill();
  }
  fillStroke() {
    this.fill(false);
    this.stroke(false);
    this.consumePath();
  }
  eoFillStroke() {
    this.pendingEOFill = true;
    this.fillStroke();
  }
  closeFillStroke() {
    this.closePath();
    this.fillStroke();
  }
  closeEOFillStroke() {
    this.pendingEOFill = true;
    this.closePath();
    this.fillStroke();
  }
  endPath() {
    this.consumePath();
  }
  clip() {
    this.pendingClip = NORMAL_CLIP;
  }
  eoClip() {
    this.pendingClip = EO_CLIP;
  }
  beginText() {
    this.current.textMatrix = IDENTITY_MATRIX;
    this.current.textMatrixScale = 1;
    this.current.x = this.current.lineX = 0;
    this.current.y = this.current.lineY = 0;
  }
  endText() {
    const paths = this.pendingTextPaths;
    const ctx = this.ctx;
    if (paths === void 0) {
      ctx.beginPath();
      return;
    }
    const newPath = new Path2D();
    const invTransf = ctx.getTransform().invertSelf();
    for (const {
      transform,
      x,
      y,
      fontSize,
      path
    } of paths) {
      newPath.addPath(path, new DOMMatrix(transform).preMultiplySelf(invTransf).translate(x, y).scale(fontSize, -fontSize));
    }
    ctx.clip(newPath);
    ctx.beginPath();
    delete this.pendingTextPaths;
  }
  setCharSpacing(spacing) {
    this.current.charSpacing = spacing;
  }
  setWordSpacing(spacing) {
    this.current.wordSpacing = spacing;
  }
  setHScale(scale) {
    this.current.textHScale = scale / 100;
  }
  setLeading(leading) {
    this.current.leading = -leading;
  }
  setFont(fontRefName, size) {
    const fontObj = this.commonObjs.get(fontRefName);
    const current = this.current;
    if (!fontObj) {
      throw new Error(`Can't find font for ${fontRefName}`);
    }
    current.fontMatrix = fontObj.fontMatrix || FONT_IDENTITY_MATRIX;
    if (current.fontMatrix[0] === 0 || current.fontMatrix[3] === 0) {
      warn("Invalid font matrix for font " + fontRefName);
    }
    if (size < 0) {
      size = -size;
      current.fontDirection = -1;
    } else {
      current.fontDirection = 1;
    }
    this.current.font = fontObj;
    this.current.fontSize = size;
    if (fontObj.isType3Font) {
      return;
    }
    const name = fontObj.loadedName || "sans-serif";
    const typeface = fontObj.systemFontInfo?.css || `"${name}", ${fontObj.fallbackName}`;
    let bold = "normal";
    if (fontObj.black) {
      bold = "900";
    } else if (fontObj.bold) {
      bold = "bold";
    }
    const italic = fontObj.italic ? "italic" : "normal";
    let browserFontSize = size;
    if (size < MIN_FONT_SIZE) {
      browserFontSize = MIN_FONT_SIZE;
    } else if (size > MAX_FONT_SIZE) {
      browserFontSize = MAX_FONT_SIZE;
    }
    this.current.fontSizeScale = size / browserFontSize;
    this.ctx.font = `${italic} ${bold} ${browserFontSize}px ${typeface}`;
  }
  setTextRenderingMode(mode) {
    this.current.textRenderingMode = mode;
  }
  setTextRise(rise) {
    this.current.textRise = rise;
  }
  moveText(x, y) {
    this.current.x = this.current.lineX += x;
    this.current.y = this.current.lineY += y;
  }
  setLeadingMoveText(x, y) {
    this.setLeading(-y);
    this.moveText(x, y);
  }
  setTextMatrix(a, b, c, d, e, f) {
    this.current.textMatrix = [a, b, c, d, e, f];
    this.current.textMatrixScale = Math.hypot(a, b);
    this.current.x = this.current.lineX = 0;
    this.current.y = this.current.lineY = 0;
  }
  nextLine() {
    this.moveText(0, this.current.leading);
  }
  #getScaledPath(path, currentTransform, transform) {
    const newPath = new Path2D();
    newPath.addPath(path, new DOMMatrix(transform).invertSelf().multiplySelf(currentTransform));
    return newPath;
  }
  paintChar(character, x, y, patternFillTransform, patternStrokeTransform) {
    const ctx = this.ctx;
    const current = this.current;
    const font = current.font;
    const textRenderingMode = current.textRenderingMode;
    const fontSize = current.fontSize / current.fontSizeScale;
    const fillStrokeMode = textRenderingMode & TextRenderingMode.FILL_STROKE_MASK;
    const isAddToPathSet = !!(textRenderingMode & TextRenderingMode.ADD_TO_PATH_FLAG);
    const patternFill = current.patternFill && !font.missingFile;
    const patternStroke = current.patternStroke && !font.missingFile;
    let path;
    if (font.disableFontFace || isAddToPathSet || patternFill || patternStroke) {
      path = font.getPathGenerator(this.commonObjs, character);
    }
    if (font.disableFontFace || patternFill || patternStroke) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(fontSize, -fontSize);
      if (fillStrokeMode === TextRenderingMode.FILL || fillStrokeMode === TextRenderingMode.FILL_STROKE) {
        if (patternFillTransform) {
          const currentTransform = ctx.getTransform();
          ctx.setTransform(...patternFillTransform);
          ctx.fill(this.#getScaledPath(path, currentTransform, patternFillTransform));
        } else {
          ctx.fill(path);
        }
      }
      if (fillStrokeMode === TextRenderingMode.STROKE || fillStrokeMode === TextRenderingMode.FILL_STROKE) {
        if (patternStrokeTransform) {
          const currentTransform = ctx.getTransform();
          ctx.setTransform(...patternStrokeTransform);
          ctx.stroke(this.#getScaledPath(path, currentTransform, patternStrokeTransform));
        } else {
          ctx.lineWidth /= fontSize;
          ctx.stroke(path);
        }
      }
      ctx.restore();
    } else {
      if (fillStrokeMode === TextRenderingMode.FILL || fillStrokeMode === TextRenderingMode.FILL_STROKE) {
        ctx.fillText(character, x, y);
      }
      if (fillStrokeMode === TextRenderingMode.STROKE || fillStrokeMode === TextRenderingMode.FILL_STROKE) {
        ctx.strokeText(character, x, y);
      }
    }
    if (isAddToPathSet) {
      const paths = this.pendingTextPaths ||= [];
      paths.push({
        transform: getCurrentTransform(ctx),
        x,
        y,
        fontSize,
        path
      });
    }
  }
  get isFontSubpixelAAEnabled() {
    const {
      context: ctx
    } = this.cachedCanvases.getCanvas("isFontSubpixelAAEnabled", 10, 10);
    ctx.scale(1.5, 1);
    ctx.fillText("I", 0, 10);
    const data = ctx.getImageData(0, 0, 10, 10).data;
    let enabled = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0 && data[i] < 255) {
        enabled = true;
        break;
      }
    }
    return shadow(this, "isFontSubpixelAAEnabled", enabled);
  }
  showText(glyphs) {
    const current = this.current;
    const font = current.font;
    if (font.isType3Font) {
      return this.showType3Text(glyphs);
    }
    const fontSize = current.fontSize;
    if (fontSize === 0) {
      return void 0;
    }
    const ctx = this.ctx;
    const fontSizeScale = current.fontSizeScale;
    const charSpacing = current.charSpacing;
    const wordSpacing = current.wordSpacing;
    const fontDirection = current.fontDirection;
    const textHScale = current.textHScale * fontDirection;
    const glyphsLength = glyphs.length;
    const vertical = font.vertical;
    const spacingDir = vertical ? 1 : -1;
    const defaultVMetrics = font.defaultVMetrics;
    const widthAdvanceScale = fontSize * current.fontMatrix[0];
    const simpleFillText = current.textRenderingMode === TextRenderingMode.FILL && !font.disableFontFace && !current.patternFill;
    ctx.save();
    ctx.transform(...current.textMatrix);
    ctx.translate(current.x, current.y + current.textRise);
    if (fontDirection > 0) {
      ctx.scale(textHScale, -1);
    } else {
      ctx.scale(textHScale, 1);
    }
    let patternFillTransform, patternStrokeTransform;
    if (current.patternFill) {
      ctx.save();
      const pattern = current.fillColor.getPattern(ctx, this, getCurrentTransformInverse(ctx), PathType.FILL);
      patternFillTransform = getCurrentTransform(ctx);
      ctx.restore();
      ctx.fillStyle = pattern;
    }
    if (current.patternStroke) {
      ctx.save();
      const pattern = current.strokeColor.getPattern(ctx, this, getCurrentTransformInverse(ctx), PathType.STROKE);
      patternStrokeTransform = getCurrentTransform(ctx);
      ctx.restore();
      ctx.strokeStyle = pattern;
    }
    let lineWidth = current.lineWidth;
    const scale = current.textMatrixScale;
    if (scale === 0 || lineWidth === 0) {
      const fillStrokeMode = current.textRenderingMode & TextRenderingMode.FILL_STROKE_MASK;
      if (fillStrokeMode === TextRenderingMode.STROKE || fillStrokeMode === TextRenderingMode.FILL_STROKE) {
        lineWidth = this.getSinglePixelWidth();
      }
    } else {
      lineWidth /= scale;
    }
    if (fontSizeScale !== 1) {
      ctx.scale(fontSizeScale, fontSizeScale);
      lineWidth /= fontSizeScale;
    }
    ctx.lineWidth = lineWidth;
    if (font.isInvalidPDFjsFont) {
      const chars = [];
      let width = 0;
      for (const glyph of glyphs) {
        chars.push(glyph.unicode);
        width += glyph.width;
      }
      ctx.fillText(chars.join(""), 0, 0);
      current.x += width * widthAdvanceScale * textHScale;
      ctx.restore();
      this.compose();
      return void 0;
    }
    let x = 0, i;
    for (i = 0; i < glyphsLength; ++i) {
      const glyph = glyphs[i];
      if (typeof glyph === "number") {
        x += spacingDir * glyph * fontSize / 1e3;
        continue;
      }
      let restoreNeeded = false;
      const spacing = (glyph.isSpace ? wordSpacing : 0) + charSpacing;
      const character = glyph.fontChar;
      const accent = glyph.accent;
      let scaledX, scaledY;
      let width = glyph.width;
      if (vertical) {
        const vmetric = glyph.vmetric || defaultVMetrics;
        const vx = -(glyph.vmetric ? vmetric[1] : width * 0.5) * widthAdvanceScale;
        const vy = vmetric[2] * widthAdvanceScale;
        width = vmetric ? -vmetric[0] : width;
        scaledX = vx / fontSizeScale;
        scaledY = (x + vy) / fontSizeScale;
      } else {
        scaledX = x / fontSizeScale;
        scaledY = 0;
      }
      if (font.remeasure && width > 0) {
        const measuredWidth = ctx.measureText(character).width * 1e3 / fontSize * fontSizeScale;
        if (width < measuredWidth && this.isFontSubpixelAAEnabled) {
          const characterScaleX = width / measuredWidth;
          restoreNeeded = true;
          ctx.save();
          ctx.scale(characterScaleX, 1);
          scaledX /= characterScaleX;
        } else if (width !== measuredWidth) {
          scaledX += (width - measuredWidth) / 2e3 * fontSize / fontSizeScale;
        }
      }
      if (this.contentVisible && (glyph.isInFont || font.missingFile)) {
        if (simpleFillText && !accent) {
          ctx.fillText(character, scaledX, scaledY);
        } else {
          this.paintChar(character, scaledX, scaledY, patternFillTransform, patternStrokeTransform);
          if (accent) {
            const scaledAccentX = scaledX + fontSize * accent.offset.x / fontSizeScale;
            const scaledAccentY = scaledY - fontSize * accent.offset.y / fontSizeScale;
            this.paintChar(accent.fontChar, scaledAccentX, scaledAccentY, patternFillTransform, patternStrokeTransform);
          }
        }
      }
      const charWidth = vertical ? width * widthAdvanceScale - spacing * fontDirection : width * widthAdvanceScale + spacing * fontDirection;
      x += charWidth;
      if (restoreNeeded) {
        ctx.restore();
      }
    }
    if (vertical) {
      current.y -= x;
    } else {
      current.x += x * textHScale;
    }
    ctx.restore();
    this.compose();
    return void 0;
  }
  showType3Text(glyphs) {
    const ctx = this.ctx;
    const current = this.current;
    const font = current.font;
    const fontSize = current.fontSize;
    const fontDirection = current.fontDirection;
    const spacingDir = font.vertical ? 1 : -1;
    const charSpacing = current.charSpacing;
    const wordSpacing = current.wordSpacing;
    const textHScale = current.textHScale * fontDirection;
    const fontMatrix = current.fontMatrix || FONT_IDENTITY_MATRIX;
    const glyphsLength = glyphs.length;
    const isTextInvisible = current.textRenderingMode === TextRenderingMode.INVISIBLE;
    let i, glyph, width, spacingLength;
    if (isTextInvisible || fontSize === 0) {
      return;
    }
    this._cachedScaleForStroking[0] = -1;
    this._cachedGetSinglePixelWidth = null;
    ctx.save();
    ctx.transform(...current.textMatrix);
    ctx.translate(current.x, current.y);
    ctx.scale(textHScale, fontDirection);
    for (i = 0; i < glyphsLength; ++i) {
      glyph = glyphs[i];
      if (typeof glyph === "number") {
        spacingLength = spacingDir * glyph * fontSize / 1e3;
        this.ctx.translate(spacingLength, 0);
        current.x += spacingLength * textHScale;
        continue;
      }
      const spacing = (glyph.isSpace ? wordSpacing : 0) + charSpacing;
      const operatorList = font.charProcOperatorList[glyph.operatorListId];
      if (!operatorList) {
        warn(`Type3 character "${glyph.operatorListId}" is not available.`);
        continue;
      }
      if (this.contentVisible) {
        this.processingType3 = glyph;
        this.save();
        ctx.scale(fontSize, fontSize);
        ctx.transform(...fontMatrix);
        this.executeOperatorList(operatorList);
        this.restore();
      }
      const transformed = Util.applyTransform([glyph.width, 0], fontMatrix);
      width = transformed[0] * fontSize + spacing;
      ctx.translate(width, 0);
      current.x += width * textHScale;
    }
    ctx.restore();
    this.processingType3 = null;
  }
  setCharWidth(xWidth, yWidth) {
  }
  setCharWidthAndBounds(xWidth, yWidth, llx, lly, urx, ury) {
    this.ctx.rect(llx, lly, urx - llx, ury - lly);
    this.ctx.clip();
    this.endPath();
  }
  getColorN_Pattern(IR) {
    let pattern;
    if (IR[0] === "TilingPattern") {
      const color = IR[1];
      const baseTransform = this.baseTransform || getCurrentTransform(this.ctx);
      const canvasGraphicsFactory = {
        createCanvasGraphics: (ctx) => new _CanvasGraphics(ctx, this.commonObjs, this.objs, this.canvasFactory, this.filterFactory, {
          optionalContentConfig: this.optionalContentConfig,
          markedContentStack: this.markedContentStack
        })
      };
      pattern = new TilingPattern(IR, color, this.ctx, canvasGraphicsFactory, baseTransform);
    } else {
      pattern = this._getPattern(IR[1], IR[2]);
    }
    return pattern;
  }
  setStrokeColorN() {
    this.current.strokeColor = this.getColorN_Pattern(arguments);
    this.current.patternStroke = true;
  }
  setFillColorN() {
    this.current.fillColor = this.getColorN_Pattern(arguments);
    this.current.patternFill = true;
  }
  setStrokeRGBColor(r, g, b) {
    this.ctx.strokeStyle = this.current.strokeColor = Util.makeHexColor(r, g, b);
    this.current.patternStroke = false;
  }
  setStrokeTransparent() {
    this.ctx.strokeStyle = this.current.strokeColor = "transparent";
    this.current.patternStroke = false;
  }
  setFillRGBColor(r, g, b) {
    this.ctx.fillStyle = this.current.fillColor = Util.makeHexColor(r, g, b);
    this.current.patternFill = false;
  }
  setFillTransparent() {
    this.ctx.fillStyle = this.current.fillColor = "transparent";
    this.current.patternFill = false;
  }
  _getPattern(objId, matrix = null) {
    let pattern;
    if (this.cachedPatterns.has(objId)) {
      pattern = this.cachedPatterns.get(objId);
    } else {
      pattern = getShadingPattern(this.getObject(objId));
      this.cachedPatterns.set(objId, pattern);
    }
    if (matrix) {
      pattern.matrix = matrix;
    }
    return pattern;
  }
  shadingFill(objId) {
    if (!this.contentVisible) {
      return;
    }
    const ctx = this.ctx;
    this.save();
    const pattern = this._getPattern(objId);
    ctx.fillStyle = pattern.getPattern(ctx, this, getCurrentTransformInverse(ctx), PathType.SHADING);
    const inv = getCurrentTransformInverse(ctx);
    if (inv) {
      const {
        width,
        height
      } = ctx.canvas;
      const [x0, y0, x1, y1] = Util.getAxialAlignedBoundingBox([0, 0, width, height], inv);
      this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    } else {
      this.ctx.fillRect(-1e10, -1e10, 2e10, 2e10);
    }
    this.compose(this.current.getClippedPathBoundingBox());
    this.restore();
  }
  beginInlineImage() {
    unreachable("Should not call beginInlineImage");
  }
  beginImageData() {
    unreachable("Should not call beginImageData");
  }
  paintFormXObjectBegin(matrix, bbox) {
    if (!this.contentVisible) {
      return;
    }
    this.save();
    this.baseTransformStack.push(this.baseTransform);
    if (matrix) {
      this.transform(...matrix);
    }
    this.baseTransform = getCurrentTransform(this.ctx);
    if (bbox) {
      const width = bbox[2] - bbox[0];
      const height = bbox[3] - bbox[1];
      this.ctx.rect(bbox[0], bbox[1], width, height);
      this.current.updateRectMinMax(getCurrentTransform(this.ctx), bbox);
      this.clip();
      this.endPath();
    }
  }
  paintFormXObjectEnd() {
    if (!this.contentVisible) {
      return;
    }
    this.restore();
    this.baseTransform = this.baseTransformStack.pop();
  }
  beginGroup(group) {
    if (!this.contentVisible) {
      return;
    }
    this.save();
    if (this.inSMaskMode) {
      this.endSMaskMode();
      this.current.activeSMask = null;
    }
    const currentCtx = this.ctx;
    if (!group.isolated) {
      info("TODO: Support non-isolated groups.");
    }
    if (group.knockout) {
      warn("Knockout groups not supported.");
    }
    const currentTransform = getCurrentTransform(currentCtx);
    if (group.matrix) {
      currentCtx.transform(...group.matrix);
    }
    if (!group.bbox) {
      throw new Error("Bounding box is required.");
    }
    let bounds = Util.getAxialAlignedBoundingBox(group.bbox, getCurrentTransform(currentCtx));
    const canvasBounds = [0, 0, currentCtx.canvas.width, currentCtx.canvas.height];
    bounds = Util.intersect(bounds, canvasBounds) || [0, 0, 0, 0];
    const offsetX = Math.floor(bounds[0]);
    const offsetY = Math.floor(bounds[1]);
    const drawnWidth = Math.max(Math.ceil(bounds[2]) - offsetX, 1);
    const drawnHeight = Math.max(Math.ceil(bounds[3]) - offsetY, 1);
    this.current.startNewPathAndClipBox([0, 0, drawnWidth, drawnHeight]);
    let cacheId = "groupAt" + this.groupLevel;
    if (group.smask) {
      cacheId += "_smask_" + this.smaskCounter++ % 2;
    }
    const scratchCanvas = this.cachedCanvases.getCanvas(cacheId, drawnWidth, drawnHeight);
    const groupCtx = scratchCanvas.context;
    groupCtx.translate(-offsetX, -offsetY);
    groupCtx.transform(...currentTransform);
    if (group.smask) {
      this.smaskStack.push({
        canvas: scratchCanvas.canvas,
        context: groupCtx,
        offsetX,
        offsetY,
        subtype: group.smask.subtype,
        backdrop: group.smask.backdrop,
        transferMap: group.smask.transferMap || null,
        startTransformInverse: null
      });
    } else {
      currentCtx.setTransform(1, 0, 0, 1, 0, 0);
      currentCtx.translate(offsetX, offsetY);
      currentCtx.save();
    }
    copyCtxState(currentCtx, groupCtx);
    this.ctx = groupCtx;
    this.setGState([["BM", "source-over"], ["ca", 1], ["CA", 1]]);
    this.groupStack.push(currentCtx);
    this.groupLevel++;
  }
  endGroup(group) {
    if (!this.contentVisible) {
      return;
    }
    this.groupLevel--;
    const groupCtx = this.ctx;
    const ctx = this.groupStack.pop();
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    if (group.smask) {
      this.tempSMask = this.smaskStack.pop();
      this.restore();
    } else {
      this.ctx.restore();
      const currentMtx = getCurrentTransform(this.ctx);
      this.restore();
      this.ctx.save();
      this.ctx.setTransform(...currentMtx);
      const dirtyBox = Util.getAxialAlignedBoundingBox([0, 0, groupCtx.canvas.width, groupCtx.canvas.height], currentMtx);
      this.ctx.drawImage(groupCtx.canvas, 0, 0);
      this.ctx.restore();
      this.compose(dirtyBox);
    }
  }
  beginAnnotation(id, rect, transform, matrix, hasOwnCanvas) {
    this.#restoreInitialState();
    resetCtxToDefault(this.ctx);
    this.ctx.save();
    this.save();
    if (this.baseTransform) {
      this.ctx.setTransform(...this.baseTransform);
    }
    if (rect) {
      const width = rect[2] - rect[0];
      const height = rect[3] - rect[1];
      if (hasOwnCanvas && this.annotationCanvasMap) {
        transform = transform.slice();
        transform[4] -= rect[0];
        transform[5] -= rect[1];
        rect = rect.slice();
        rect[0] = rect[1] = 0;
        rect[2] = width;
        rect[3] = height;
        const [scaleX, scaleY] = Util.singularValueDecompose2dScale(getCurrentTransform(this.ctx));
        const {
          viewportScale
        } = this;
        const canvasWidth = Math.ceil(width * this.outputScaleX * viewportScale);
        const canvasHeight = Math.ceil(height * this.outputScaleY * viewportScale);
        this.annotationCanvas = this.canvasFactory.create(canvasWidth, canvasHeight);
        const {
          canvas,
          context
        } = this.annotationCanvas;
        this.annotationCanvasMap.set(id, canvas);
        this.annotationCanvas.savedCtx = this.ctx;
        this.ctx = context;
        this.ctx.save();
        this.ctx.setTransform(scaleX, 0, 0, -scaleY, 0, height * scaleY);
        resetCtxToDefault(this.ctx);
      } else {
        resetCtxToDefault(this.ctx);
        this.endPath();
        this.ctx.rect(rect[0], rect[1], width, height);
        this.ctx.clip();
        this.ctx.beginPath();
      }
    }
    this.current = new CanvasExtraState(this.ctx.canvas.width, this.ctx.canvas.height);
    this.transform(...transform);
    this.transform(...matrix);
  }
  endAnnotation() {
    if (this.annotationCanvas) {
      this.ctx.restore();
      this.#drawFilter();
      this.ctx = this.annotationCanvas.savedCtx;
      delete this.annotationCanvas.savedCtx;
      delete this.annotationCanvas;
    }
  }
  paintImageMaskXObject(img) {
    if (!this.contentVisible) {
      return;
    }
    const count = img.count;
    img = this.getObject(img.data, img);
    img.count = count;
    const ctx = this.ctx;
    const glyph = this.processingType3;
    if (glyph) {
      if (glyph.compiled === void 0) {
        glyph.compiled = compileType3Glyph(img);
      }
      if (glyph.compiled) {
        glyph.compiled(ctx);
        return;
      }
    }
    const mask = this._createMaskCanvas(img);
    const maskCanvas = mask.canvas;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(maskCanvas, mask.offsetX, mask.offsetY);
    ctx.restore();
    this.compose();
  }
  paintImageMaskXObjectRepeat(img, scaleX, skewX = 0, skewY = 0, scaleY, positions) {
    if (!this.contentVisible) {
      return;
    }
    img = this.getObject(img.data, img);
    const ctx = this.ctx;
    ctx.save();
    const currentTransform = getCurrentTransform(ctx);
    ctx.transform(scaleX, skewX, skewY, scaleY, 0, 0);
    const mask = this._createMaskCanvas(img);
    ctx.setTransform(1, 0, 0, 1, mask.offsetX - currentTransform[4], mask.offsetY - currentTransform[5]);
    for (let i = 0, ii = positions.length; i < ii; i += 2) {
      const trans = Util.transform(currentTransform, [scaleX, skewX, skewY, scaleY, positions[i], positions[i + 1]]);
      const [x, y] = Util.applyTransform([0, 0], trans);
      ctx.drawImage(mask.canvas, x, y);
    }
    ctx.restore();
    this.compose();
  }
  paintImageMaskXObjectGroup(images) {
    if (!this.contentVisible) {
      return;
    }
    const ctx = this.ctx;
    const fillColor = this.current.fillColor;
    const isPatternFill = this.current.patternFill;
    for (const image of images) {
      const {
        data,
        width,
        height,
        transform
      } = image;
      const maskCanvas = this.cachedCanvases.getCanvas("maskCanvas", width, height);
      const maskCtx = maskCanvas.context;
      maskCtx.save();
      const img = this.getObject(data, image);
      putBinaryImageMask(maskCtx, img);
      maskCtx.globalCompositeOperation = "source-in";
      maskCtx.fillStyle = isPatternFill ? fillColor.getPattern(maskCtx, this, getCurrentTransformInverse(ctx), PathType.FILL) : fillColor;
      maskCtx.fillRect(0, 0, width, height);
      maskCtx.restore();
      ctx.save();
      ctx.transform(...transform);
      ctx.scale(1, -1);
      drawImageAtIntegerCoords(ctx, maskCanvas.canvas, 0, 0, width, height, 0, -1, 1, 1);
      ctx.restore();
    }
    this.compose();
  }
  paintImageXObject(objId) {
    if (!this.contentVisible) {
      return;
    }
    const imgData = this.getObject(objId);
    if (!imgData) {
      warn("Dependent image isn't ready yet");
      return;
    }
    this.paintInlineImageXObject(imgData);
  }
  paintImageXObjectRepeat(objId, scaleX, scaleY, positions) {
    if (!this.contentVisible) {
      return;
    }
    const imgData = this.getObject(objId);
    if (!imgData) {
      warn("Dependent image isn't ready yet");
      return;
    }
    const width = imgData.width;
    const height = imgData.height;
    const map = [];
    for (let i = 0, ii = positions.length; i < ii; i += 2) {
      map.push({
        transform: [scaleX, 0, 0, scaleY, positions[i], positions[i + 1]],
        x: 0,
        y: 0,
        w: width,
        h: height
      });
    }
    this.paintInlineImageXObjectGroup(imgData, map);
  }
  applyTransferMapsToCanvas(ctx) {
    if (this.current.transferMaps !== "none") {
      ctx.filter = this.current.transferMaps;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = "none";
    }
    return ctx.canvas;
  }
  applyTransferMapsToBitmap(imgData) {
    if (this.current.transferMaps === "none") {
      return imgData.bitmap;
    }
    const {
      bitmap,
      width,
      height
    } = imgData;
    const tmpCanvas = this.cachedCanvases.getCanvas("inlineImage", width, height);
    const tmpCtx = tmpCanvas.context;
    tmpCtx.filter = this.current.transferMaps;
    tmpCtx.drawImage(bitmap, 0, 0);
    tmpCtx.filter = "none";
    return tmpCanvas.canvas;
  }
  paintInlineImageXObject(imgData) {
    if (!this.contentVisible) {
      return;
    }
    const width = imgData.width;
    const height = imgData.height;
    const ctx = this.ctx;
    this.save();
    if (!isNodeJS) {
      const {
        filter
      } = ctx;
      if (filter !== "none" && filter !== "") {
        ctx.filter = "none";
      }
    }
    ctx.scale(1 / width, -1 / height);
    let imgToPaint;
    if (imgData.bitmap) {
      imgToPaint = this.applyTransferMapsToBitmap(imgData);
    } else if (typeof HTMLElement === "function" && imgData instanceof HTMLElement || !imgData.data) {
      imgToPaint = imgData;
    } else {
      const tmpCanvas = this.cachedCanvases.getCanvas("inlineImage", width, height);
      const tmpCtx = tmpCanvas.context;
      putBinaryImageData(tmpCtx, imgData);
      imgToPaint = this.applyTransferMapsToCanvas(tmpCtx);
    }
    const scaled = this._scaleImage(imgToPaint, getCurrentTransformInverse(ctx));
    ctx.imageSmoothingEnabled = getImageSmoothingEnabled(getCurrentTransform(ctx), imgData.interpolate);
    drawImageAtIntegerCoords(ctx, scaled.img, 0, 0, scaled.paintWidth, scaled.paintHeight, 0, -height, width, height);
    this.compose();
    this.restore();
  }
  paintInlineImageXObjectGroup(imgData, map) {
    if (!this.contentVisible) {
      return;
    }
    const ctx = this.ctx;
    let imgToPaint;
    if (imgData.bitmap) {
      imgToPaint = imgData.bitmap;
    } else {
      const w = imgData.width;
      const h = imgData.height;
      const tmpCanvas = this.cachedCanvases.getCanvas("inlineImage", w, h);
      const tmpCtx = tmpCanvas.context;
      putBinaryImageData(tmpCtx, imgData);
      imgToPaint = this.applyTransferMapsToCanvas(tmpCtx);
    }
    for (const entry of map) {
      ctx.save();
      ctx.transform(...entry.transform);
      ctx.scale(1, -1);
      drawImageAtIntegerCoords(ctx, imgToPaint, entry.x, entry.y, entry.w, entry.h, 0, -1, 1, 1);
      ctx.restore();
    }
    this.compose();
  }
  paintSolidColorImageMask() {
    if (!this.contentVisible) {
      return;
    }
    this.ctx.fillRect(0, 0, 1, 1);
    this.compose();
  }
  markPoint(tag) {
  }
  markPointProps(tag, properties) {
  }
  beginMarkedContent(tag) {
    this.markedContentStack.push({
      visible: true
    });
  }
  beginMarkedContentProps(tag, properties) {
    if (tag === "OC") {
      this.markedContentStack.push({
        visible: this.optionalContentConfig.isVisible(properties)
      });
    } else {
      this.markedContentStack.push({
        visible: true
      });
    }
    this.contentVisible = this.isContentVisible();
  }
  endMarkedContent() {
    this.markedContentStack.pop();
    this.contentVisible = this.isContentVisible();
  }
  beginCompat() {
  }
  endCompat() {
  }
  consumePath(clipBox) {
    const isEmpty = this.current.isEmptyClip();
    if (this.pendingClip) {
      this.current.updateClipFromPath();
    }
    if (!this.pendingClip) {
      this.compose(clipBox);
    }
    const ctx = this.ctx;
    if (this.pendingClip) {
      if (!isEmpty) {
        if (this.pendingClip === EO_CLIP) {
          ctx.clip("evenodd");
        } else {
          ctx.clip();
        }
      }
      this.pendingClip = null;
    }
    this.current.startNewPathAndClipBox(this.current.clipBox);
    ctx.beginPath();
  }
  getSinglePixelWidth() {
    if (!this._cachedGetSinglePixelWidth) {
      const m = getCurrentTransform(this.ctx);
      if (m[1] === 0 && m[2] === 0) {
        this._cachedGetSinglePixelWidth = 1 / Math.min(Math.abs(m[0]), Math.abs(m[3]));
      } else {
        const absDet = Math.abs(m[0] * m[3] - m[2] * m[1]);
        const normX = Math.hypot(m[0], m[2]);
        const normY = Math.hypot(m[1], m[3]);
        this._cachedGetSinglePixelWidth = Math.max(normX, normY) / absDet;
      }
    }
    return this._cachedGetSinglePixelWidth;
  }
  getScaleForStroking() {
    if (this._cachedScaleForStroking[0] === -1) {
      const {
        lineWidth
      } = this.current;
      const {
        a,
        b,
        c,
        d
      } = this.ctx.getTransform();
      let scaleX, scaleY;
      if (b === 0 && c === 0) {
        const normX = Math.abs(a);
        const normY = Math.abs(d);
        if (normX === normY) {
          if (lineWidth === 0) {
            scaleX = scaleY = 1 / normX;
          } else {
            const scaledLineWidth = normX * lineWidth;
            scaleX = scaleY = scaledLineWidth < 1 ? 1 / scaledLineWidth : 1;
          }
        } else if (lineWidth === 0) {
          scaleX = 1 / normX;
          scaleY = 1 / normY;
        } else {
          const scaledXLineWidth = normX * lineWidth;
          const scaledYLineWidth = normY * lineWidth;
          scaleX = scaledXLineWidth < 1 ? 1 / scaledXLineWidth : 1;
          scaleY = scaledYLineWidth < 1 ? 1 / scaledYLineWidth : 1;
        }
      } else {
        const absDet = Math.abs(a * d - b * c);
        const normX = Math.hypot(a, b);
        const normY = Math.hypot(c, d);
        if (lineWidth === 0) {
          scaleX = normY / absDet;
          scaleY = normX / absDet;
        } else {
          const baseArea = lineWidth * absDet;
          scaleX = normY > baseArea ? normY / baseArea : 1;
          scaleY = normX > baseArea ? normX / baseArea : 1;
        }
      }
      this._cachedScaleForStroking[0] = scaleX;
      this._cachedScaleForStroking[1] = scaleY;
    }
    return this._cachedScaleForStroking;
  }
  rescaleAndStroke(saveRestore) {
    const {
      ctx
    } = this;
    const {
      lineWidth
    } = this.current;
    const [scaleX, scaleY] = this.getScaleForStroking();
    ctx.lineWidth = lineWidth || 1;
    if (scaleX === 1 && scaleY === 1) {
      ctx.stroke();
      return;
    }
    const dashes = ctx.getLineDash();
    if (saveRestore) {
      ctx.save();
    }
    ctx.scale(scaleX, scaleY);
    if (dashes.length > 0) {
      const scale = Math.max(scaleX, scaleY);
      ctx.setLineDash(dashes.map((x) => x / scale));
      ctx.lineDashOffset /= scale;
    }
    ctx.stroke();
    if (saveRestore) {
      ctx.restore();
    }
  }
  isContentVisible() {
    for (let i = this.markedContentStack.length - 1; i >= 0; i--) {
      if (!this.markedContentStack[i].visible) {
        return false;
      }
    }
    return true;
  }
};
for (const op in OPS) {
  if (CanvasGraphics.prototype[op] !== void 0) {
    CanvasGraphics.prototype[OPS[op]] = CanvasGraphics.prototype[op];
  }
}
var GlobalWorkerOptions = class {
  static #port = null;
  static #src = "";
  static get workerPort() {
    return this.#port;
  }
  static set workerPort(val) {
    if (!(typeof Worker !== "undefined" && val instanceof Worker) && val !== null) {
      throw new Error("Invalid `workerPort` type.");
    }
    this.#port = val;
  }
  static get workerSrc() {
    return this.#src;
  }
  static set workerSrc(val) {
    if (typeof val !== "string") {
      throw new Error("Invalid `workerSrc` type.");
    }
    this.#src = val;
  }
};
var Metadata = class {
  #metadataMap;
  #data;
  constructor({
    parsedData,
    rawData
  }) {
    this.#metadataMap = parsedData;
    this.#data = rawData;
  }
  getRaw() {
    return this.#data;
  }
  get(name) {
    return this.#metadataMap.get(name) ?? null;
  }
  getAll() {
    return objectFromMap(this.#metadataMap);
  }
  has(name) {
    return this.#metadataMap.has(name);
  }
};
var INTERNAL = /* @__PURE__ */ Symbol("INTERNAL");
var OptionalContentGroup = class {
  #isDisplay = false;
  #isPrint = false;
  #userSet = false;
  #visible = true;
  constructor(renderingIntent, {
    name,
    intent,
    usage,
    rbGroups
  }) {
    this.#isDisplay = !!(renderingIntent & RenderingIntentFlag.DISPLAY);
    this.#isPrint = !!(renderingIntent & RenderingIntentFlag.PRINT);
    this.name = name;
    this.intent = intent;
    this.usage = usage;
    this.rbGroups = rbGroups;
  }
  get visible() {
    if (this.#userSet) {
      return this.#visible;
    }
    if (!this.#visible) {
      return false;
    }
    const {
      print,
      view
    } = this.usage;
    if (this.#isDisplay) {
      return view?.viewState !== "OFF";
    } else if (this.#isPrint) {
      return print?.printState !== "OFF";
    }
    return true;
  }
  _setVisible(internal, visible, userSet = false) {
    if (internal !== INTERNAL) {
      unreachable("Internal method `_setVisible` called.");
    }
    this.#userSet = userSet;
    this.#visible = visible;
  }
};
var OptionalContentConfig = class {
  #cachedGetHash = null;
  #groups = /* @__PURE__ */ new Map();
  #initialHash = null;
  #order = null;
  constructor(data, renderingIntent = RenderingIntentFlag.DISPLAY) {
    this.renderingIntent = renderingIntent;
    this.name = null;
    this.creator = null;
    if (data === null) {
      return;
    }
    this.name = data.name;
    this.creator = data.creator;
    this.#order = data.order;
    for (const group of data.groups) {
      this.#groups.set(group.id, new OptionalContentGroup(renderingIntent, group));
    }
    if (data.baseState === "OFF") {
      for (const group of this.#groups.values()) {
        group._setVisible(INTERNAL, false);
      }
    }
    for (const on of data.on) {
      this.#groups.get(on)._setVisible(INTERNAL, true);
    }
    for (const off of data.off) {
      this.#groups.get(off)._setVisible(INTERNAL, false);
    }
    this.#initialHash = this.getHash();
  }
  #evaluateVisibilityExpression(array) {
    const length = array.length;
    if (length < 2) {
      return true;
    }
    const operator = array[0];
    for (let i = 1; i < length; i++) {
      const element = array[i];
      let state;
      if (Array.isArray(element)) {
        state = this.#evaluateVisibilityExpression(element);
      } else if (this.#groups.has(element)) {
        state = this.#groups.get(element).visible;
      } else {
        warn(`Optional content group not found: ${element}`);
        return true;
      }
      switch (operator) {
        case "And":
          if (!state) {
            return false;
          }
          break;
        case "Or":
          if (state) {
            return true;
          }
          break;
        case "Not":
          return !state;
        default:
          return true;
      }
    }
    return operator === "And";
  }
  isVisible(group) {
    if (this.#groups.size === 0) {
      return true;
    }
    if (!group) {
      info("Optional content group not defined.");
      return true;
    }
    if (group.type === "OCG") {
      if (!this.#groups.has(group.id)) {
        warn(`Optional content group not found: ${group.id}`);
        return true;
      }
      return this.#groups.get(group.id).visible;
    } else if (group.type === "OCMD") {
      if (group.expression) {
        return this.#evaluateVisibilityExpression(group.expression);
      }
      if (!group.policy || group.policy === "AnyOn") {
        for (const id of group.ids) {
          if (!this.#groups.has(id)) {
            warn(`Optional content group not found: ${id}`);
            return true;
          }
          if (this.#groups.get(id).visible) {
            return true;
          }
        }
        return false;
      } else if (group.policy === "AllOn") {
        for (const id of group.ids) {
          if (!this.#groups.has(id)) {
            warn(`Optional content group not found: ${id}`);
            return true;
          }
          if (!this.#groups.get(id).visible) {
            return false;
          }
        }
        return true;
      } else if (group.policy === "AnyOff") {
        for (const id of group.ids) {
          if (!this.#groups.has(id)) {
            warn(`Optional content group not found: ${id}`);
            return true;
          }
          if (!this.#groups.get(id).visible) {
            return true;
          }
        }
        return false;
      } else if (group.policy === "AllOff") {
        for (const id of group.ids) {
          if (!this.#groups.has(id)) {
            warn(`Optional content group not found: ${id}`);
            return true;
          }
          if (this.#groups.get(id).visible) {
            return false;
          }
        }
        return true;
      }
      warn(`Unknown optional content policy ${group.policy}.`);
      return true;
    }
    warn(`Unknown group type ${group.type}.`);
    return true;
  }
  setVisibility(id, visible = true, preserveRB = true) {
    const group = this.#groups.get(id);
    if (!group) {
      warn(`Optional content group not found: ${id}`);
      return;
    }
    if (preserveRB && visible && group.rbGroups.length) {
      for (const rbGroup of group.rbGroups) {
        for (const otherId of rbGroup) {
          if (otherId !== id) {
            this.#groups.get(otherId)?._setVisible(INTERNAL, false, true);
          }
        }
      }
    }
    group._setVisible(INTERNAL, !!visible, true);
    this.#cachedGetHash = null;
  }
  setOCGState({
    state,
    preserveRB
  }) {
    let operator;
    for (const elem of state) {
      switch (elem) {
        case "ON":
        case "OFF":
        case "Toggle":
          operator = elem;
          continue;
      }
      const group = this.#groups.get(elem);
      if (!group) {
        continue;
      }
      switch (operator) {
        case "ON":
          this.setVisibility(elem, true, preserveRB);
          break;
        case "OFF":
          this.setVisibility(elem, false, preserveRB);
          break;
        case "Toggle":
          this.setVisibility(elem, !group.visible, preserveRB);
          break;
      }
    }
    this.#cachedGetHash = null;
  }
  get hasInitialVisibility() {
    return this.#initialHash === null || this.getHash() === this.#initialHash;
  }
  getOrder() {
    if (!this.#groups.size) {
      return null;
    }
    if (this.#order) {
      return this.#order.slice();
    }
    return [...this.#groups.keys()];
  }
  getGroups() {
    return this.#groups.size > 0 ? objectFromMap(this.#groups) : null;
  }
  getGroup(id) {
    return this.#groups.get(id) || null;
  }
  getHash() {
    if (this.#cachedGetHash !== null) {
      return this.#cachedGetHash;
    }
    const hash = new MurmurHash3_64();
    for (const [id, group] of this.#groups) {
      hash.update(`${id}:${group.visible}`);
    }
    return this.#cachedGetHash = hash.hexdigest();
  }
};
var PDFDataTransportStream = class {
  constructor(pdfDataRangeTransport, {
    disableRange = false,
    disableStream = false
  }) {
    assert(pdfDataRangeTransport, 'PDFDataTransportStream - missing required "pdfDataRangeTransport" argument.');
    const {
      length,
      initialData,
      progressiveDone,
      contentDispositionFilename
    } = pdfDataRangeTransport;
    this._queuedChunks = [];
    this._progressiveDone = progressiveDone;
    this._contentDispositionFilename = contentDispositionFilename;
    if (initialData?.length > 0) {
      const buffer = initialData instanceof Uint8Array && initialData.byteLength === initialData.buffer.byteLength ? initialData.buffer : new Uint8Array(initialData).buffer;
      this._queuedChunks.push(buffer);
    }
    this._pdfDataRangeTransport = pdfDataRangeTransport;
    this._isStreamingSupported = !disableStream;
    this._isRangeSupported = !disableRange;
    this._contentLength = length;
    this._fullRequestReader = null;
    this._rangeReaders = [];
    pdfDataRangeTransport.addRangeListener((begin, chunk) => {
      this._onReceiveData({
        begin,
        chunk
      });
    });
    pdfDataRangeTransport.addProgressListener((loaded, total) => {
      this._onProgress({
        loaded,
        total
      });
    });
    pdfDataRangeTransport.addProgressiveReadListener((chunk) => {
      this._onReceiveData({
        chunk
      });
    });
    pdfDataRangeTransport.addProgressiveDoneListener(() => {
      this._onProgressiveDone();
    });
    pdfDataRangeTransport.transportReady();
  }
  _onReceiveData({
    begin,
    chunk
  }) {
    const buffer = chunk instanceof Uint8Array && chunk.byteLength === chunk.buffer.byteLength ? chunk.buffer : new Uint8Array(chunk).buffer;
    if (begin === void 0) {
      if (this._fullRequestReader) {
        this._fullRequestReader._enqueue(buffer);
      } else {
        this._queuedChunks.push(buffer);
      }
    } else {
      const found = this._rangeReaders.some(function(rangeReader) {
        if (rangeReader._begin !== begin) {
          return false;
        }
        rangeReader._enqueue(buffer);
        return true;
      });
      assert(found, "_onReceiveData - no `PDFDataTransportStreamRangeReader` instance found.");
    }
  }
  get _progressiveDataLength() {
    return this._fullRequestReader?._loaded ?? 0;
  }
  _onProgress(evt) {
    if (evt.total === void 0) {
      this._rangeReaders[0]?.onProgress?.({
        loaded: evt.loaded
      });
    } else {
      this._fullRequestReader?.onProgress?.({
        loaded: evt.loaded,
        total: evt.total
      });
    }
  }
  _onProgressiveDone() {
    this._fullRequestReader?.progressiveDone();
    this._progressiveDone = true;
  }
  _removeRangeReader(reader) {
    const i = this._rangeReaders.indexOf(reader);
    if (i >= 0) {
      this._rangeReaders.splice(i, 1);
    }
  }
  getFullReader() {
    assert(!this._fullRequestReader, "PDFDataTransportStream.getFullReader can only be called once.");
    const queuedChunks = this._queuedChunks;
    this._queuedChunks = null;
    return new PDFDataTransportStreamReader(this, queuedChunks, this._progressiveDone, this._contentDispositionFilename);
  }
  getRangeReader(begin, end) {
    if (end <= this._progressiveDataLength) {
      return null;
    }
    const reader = new PDFDataTransportStreamRangeReader(this, begin, end);
    this._pdfDataRangeTransport.requestDataRange(begin, end);
    this._rangeReaders.push(reader);
    return reader;
  }
  cancelAllRequests(reason) {
    this._fullRequestReader?.cancel(reason);
    for (const reader of this._rangeReaders.slice(0)) {
      reader.cancel(reason);
    }
    this._pdfDataRangeTransport.abort();
  }
};
var PDFDataTransportStreamReader = class {
  constructor(stream, queuedChunks, progressiveDone = false, contentDispositionFilename = null) {
    this._stream = stream;
    this._done = progressiveDone || false;
    this._filename = isPdfFile(contentDispositionFilename) ? contentDispositionFilename : null;
    this._queuedChunks = queuedChunks || [];
    this._loaded = 0;
    for (const chunk of this._queuedChunks) {
      this._loaded += chunk.byteLength;
    }
    this._requests = [];
    this._headersReady = Promise.resolve();
    stream._fullRequestReader = this;
    this.onProgress = null;
  }
  _enqueue(chunk) {
    if (this._done) {
      return;
    }
    if (this._requests.length > 0) {
      const requestCapability = this._requests.shift();
      requestCapability.resolve({
        value: chunk,
        done: false
      });
    } else {
      this._queuedChunks.push(chunk);
    }
    this._loaded += chunk.byteLength;
  }
  get headersReady() {
    return this._headersReady;
  }
  get filename() {
    return this._filename;
  }
  get isRangeSupported() {
    return this._stream._isRangeSupported;
  }
  get isStreamingSupported() {
    return this._stream._isStreamingSupported;
  }
  get contentLength() {
    return this._stream._contentLength;
  }
  async read() {
    if (this._queuedChunks.length > 0) {
      const chunk = this._queuedChunks.shift();
      return {
        value: chunk,
        done: false
      };
    }
    if (this._done) {
      return {
        value: void 0,
        done: true
      };
    }
    const requestCapability = Promise.withResolvers();
    this._requests.push(requestCapability);
    return requestCapability.promise;
  }
  cancel(reason) {
    this._done = true;
    for (const requestCapability of this._requests) {
      requestCapability.resolve({
        value: void 0,
        done: true
      });
    }
    this._requests.length = 0;
  }
  progressiveDone() {
    if (this._done) {
      return;
    }
    this._done = true;
  }
};
var PDFDataTransportStreamRangeReader = class {
  constructor(stream, begin, end) {
    this._stream = stream;
    this._begin = begin;
    this._end = end;
    this._queuedChunk = null;
    this._requests = [];
    this._done = false;
    this.onProgress = null;
  }
  _enqueue(chunk) {
    if (this._done) {
      return;
    }
    if (this._requests.length === 0) {
      this._queuedChunk = chunk;
    } else {
      const requestsCapability = this._requests.shift();
      requestsCapability.resolve({
        value: chunk,
        done: false
      });
      for (const requestCapability of this._requests) {
        requestCapability.resolve({
          value: void 0,
          done: true
        });
      }
      this._requests.length = 0;
    }
    this._done = true;
    this._stream._removeRangeReader(this);
  }
  get isStreamingSupported() {
    return false;
  }
  async read() {
    if (this._queuedChunk) {
      const chunk = this._queuedChunk;
      this._queuedChunk = null;
      return {
        value: chunk,
        done: false
      };
    }
    if (this._done) {
      return {
        value: void 0,
        done: true
      };
    }
    const requestCapability = Promise.withResolvers();
    this._requests.push(requestCapability);
    return requestCapability.promise;
  }
  cancel(reason) {
    this._done = true;
    for (const requestCapability of this._requests) {
      requestCapability.resolve({
        value: void 0,
        done: true
      });
    }
    this._requests.length = 0;
    this._stream._removeRangeReader(this);
  }
};
function getFilenameFromContentDispositionHeader(contentDisposition) {
  let needsEncodingFixup = true;
  let tmp = toParamRegExp("filename\\*", "i").exec(contentDisposition);
  if (tmp) {
    tmp = tmp[1];
    let filename = rfc2616unquote(tmp);
    filename = unescape(filename);
    filename = rfc5987decode(filename);
    filename = rfc2047decode(filename);
    return fixupEncoding(filename);
  }
  tmp = rfc2231getparam(contentDisposition);
  if (tmp) {
    const filename = rfc2047decode(tmp);
    return fixupEncoding(filename);
  }
  tmp = toParamRegExp("filename", "i").exec(contentDisposition);
  if (tmp) {
    tmp = tmp[1];
    let filename = rfc2616unquote(tmp);
    filename = rfc2047decode(filename);
    return fixupEncoding(filename);
  }
  function toParamRegExp(attributePattern, flags) {
    return new RegExp("(?:^|;)\\s*" + attributePattern + '\\s*=\\s*([^";\\s][^;\\s]*|"(?:[^"\\\\]|\\\\"?)+"?)', flags);
  }
  function textdecode(encoding, value) {
    if (encoding) {
      if (!/^[\x00-\xFF]+$/.test(value)) {
        return value;
      }
      try {
        const decoder = new TextDecoder(encoding, {
          fatal: true
        });
        const buffer = stringToBytes(value);
        value = decoder.decode(buffer);
        needsEncodingFixup = false;
      } catch {
      }
    }
    return value;
  }
  function fixupEncoding(value) {
    if (needsEncodingFixup && /[\x80-\xff]/.test(value)) {
      value = textdecode("utf-8", value);
      if (needsEncodingFixup) {
        value = textdecode("iso-8859-1", value);
      }
    }
    return value;
  }
  function rfc2231getparam(contentDispositionStr) {
    const matches = [];
    let match;
    const iter = toParamRegExp("filename\\*((?!0\\d)\\d+)(\\*?)", "ig");
    while ((match = iter.exec(contentDispositionStr)) !== null) {
      let [, n, quot, part] = match;
      n = parseInt(n, 10);
      if (n in matches) {
        if (n === 0) {
          break;
        }
        continue;
      }
      matches[n] = [quot, part];
    }
    const parts = [];
    for (let n = 0; n < matches.length; ++n) {
      if (!(n in matches)) {
        break;
      }
      let [quot, part] = matches[n];
      part = rfc2616unquote(part);
      if (quot) {
        part = unescape(part);
        if (n === 0) {
          part = rfc5987decode(part);
        }
      }
      parts.push(part);
    }
    return parts.join("");
  }
  function rfc2616unquote(value) {
    if (value.startsWith('"')) {
      const parts = value.slice(1).split('\\"');
      for (let i = 0; i < parts.length; ++i) {
        const quotindex = parts[i].indexOf('"');
        if (quotindex !== -1) {
          parts[i] = parts[i].slice(0, quotindex);
          parts.length = i + 1;
        }
        parts[i] = parts[i].replaceAll(/\\(.)/g, "$1");
      }
      value = parts.join('"');
    }
    return value;
  }
  function rfc5987decode(extvalue) {
    const encodingend = extvalue.indexOf("'");
    if (encodingend === -1) {
      return extvalue;
    }
    const encoding = extvalue.slice(0, encodingend);
    const langvalue = extvalue.slice(encodingend + 1);
    const value = langvalue.replace(/^[^']*'/, "");
    return textdecode(encoding, value);
  }
  function rfc2047decode(value) {
    if (!value.startsWith("=?") || /[\x00-\x19\x80-\xff]/.test(value)) {
      return value;
    }
    return value.replaceAll(/=\?([\w-]*)\?([QqBb])\?((?:[^?]|\?(?!=))*)\?=/g, function(matches, charset, encoding, text) {
      if (encoding === "q" || encoding === "Q") {
        text = text.replaceAll("_", " ");
        text = text.replaceAll(/=([0-9a-fA-F]{2})/g, function(match, hex) {
          return String.fromCharCode(parseInt(hex, 16));
        });
        return textdecode(charset, text);
      }
      try {
        text = atob(text);
      } catch {
      }
      return textdecode(charset, text);
    });
  }
  return "";
}
function createHeaders(isHttp, httpHeaders) {
  const headers = new Headers();
  if (!isHttp || !httpHeaders || typeof httpHeaders !== "object") {
    return headers;
  }
  for (const key in httpHeaders) {
    const val = httpHeaders[key];
    if (val !== void 0) {
      headers.append(key, val);
    }
  }
  return headers;
}
function getResponseOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
  }
  return null;
}
function validateRangeRequestCapabilities({
  responseHeaders,
  isHttp,
  rangeChunkSize,
  disableRange
}) {
  const returnValues = {
    allowRangeRequests: false,
    suggestedLength: void 0
  };
  const length = parseInt(responseHeaders.get("Content-Length"), 10);
  if (!Number.isInteger(length)) {
    return returnValues;
  }
  returnValues.suggestedLength = length;
  if (length <= 2 * rangeChunkSize) {
    return returnValues;
  }
  if (disableRange || !isHttp) {
    return returnValues;
  }
  if (responseHeaders.get("Accept-Ranges") !== "bytes") {
    return returnValues;
  }
  const contentEncoding = responseHeaders.get("Content-Encoding") || "identity";
  if (contentEncoding !== "identity") {
    return returnValues;
  }
  returnValues.allowRangeRequests = true;
  return returnValues;
}
function extractFilenameFromHeader(responseHeaders) {
  const contentDisposition = responseHeaders.get("Content-Disposition");
  if (contentDisposition) {
    let filename = getFilenameFromContentDispositionHeader(contentDisposition);
    if (filename.includes("%")) {
      try {
        filename = decodeURIComponent(filename);
      } catch {
      }
    }
    if (isPdfFile(filename)) {
      return filename;
    }
  }
  return null;
}
function createResponseStatusError(status, url) {
  if (status === 404 || status === 0 && url.startsWith("file:")) {
    return new MissingPDFException('Missing PDF "' + url + '".');
  }
  return new UnexpectedResponseException(`Unexpected server response (${status}) while retrieving PDF "${url}".`, status);
}
function validateResponseStatus(status) {
  return status === 200 || status === 206;
}
function createFetchOptions(headers, withCredentials, abortController) {
  return {
    method: "GET",
    headers,
    signal: abortController.signal,
    mode: "cors",
    credentials: withCredentials ? "include" : "same-origin",
    redirect: "follow"
  };
}
function getArrayBuffer(val) {
  if (val instanceof Uint8Array) {
    return val.buffer;
  }
  if (val instanceof ArrayBuffer) {
    return val;
  }
  warn(`getArrayBuffer - unexpected data format: ${val}`);
  return new Uint8Array(val).buffer;
}
var PDFFetchStream = class {
  _responseOrigin = null;
  constructor(source) {
    this.source = source;
    this.isHttp = /^https?:/i.test(source.url);
    this.headers = createHeaders(this.isHttp, source.httpHeaders);
    this._fullRequestReader = null;
    this._rangeRequestReaders = [];
  }
  get _progressiveDataLength() {
    return this._fullRequestReader?._loaded ?? 0;
  }
  getFullReader() {
    assert(!this._fullRequestReader, "PDFFetchStream.getFullReader can only be called once.");
    this._fullRequestReader = new PDFFetchStreamReader(this);
    return this._fullRequestReader;
  }
  getRangeReader(begin, end) {
    if (end <= this._progressiveDataLength) {
      return null;
    }
    const reader = new PDFFetchStreamRangeReader(this, begin, end);
    this._rangeRequestReaders.push(reader);
    return reader;
  }
  cancelAllRequests(reason) {
    this._fullRequestReader?.cancel(reason);
    for (const reader of this._rangeRequestReaders.slice(0)) {
      reader.cancel(reason);
    }
  }
};
var PDFFetchStreamReader = class {
  constructor(stream) {
    this._stream = stream;
    this._reader = null;
    this._loaded = 0;
    this._filename = null;
    const source = stream.source;
    this._withCredentials = source.withCredentials || false;
    this._contentLength = source.length;
    this._headersCapability = Promise.withResolvers();
    this._disableRange = source.disableRange || false;
    this._rangeChunkSize = source.rangeChunkSize;
    if (!this._rangeChunkSize && !this._disableRange) {
      this._disableRange = true;
    }
    this._abortController = new AbortController();
    this._isStreamingSupported = !source.disableStream;
    this._isRangeSupported = !source.disableRange;
    const headers = new Headers(stream.headers);
    const url = source.url;
    fetch(url, createFetchOptions(headers, this._withCredentials, this._abortController)).then((response) => {
      stream._responseOrigin = getResponseOrigin(response.url);
      if (!validateResponseStatus(response.status)) {
        throw createResponseStatusError(response.status, url);
      }
      this._reader = response.body.getReader();
      this._headersCapability.resolve();
      const responseHeaders = response.headers;
      const {
        allowRangeRequests,
        suggestedLength
      } = validateRangeRequestCapabilities({
        responseHeaders,
        isHttp: stream.isHttp,
        rangeChunkSize: this._rangeChunkSize,
        disableRange: this._disableRange
      });
      this._isRangeSupported = allowRangeRequests;
      this._contentLength = suggestedLength || this._contentLength;
      this._filename = extractFilenameFromHeader(responseHeaders);
      if (!this._isStreamingSupported && this._isRangeSupported) {
        this.cancel(new AbortException("Streaming is disabled."));
      }
    }).catch(this._headersCapability.reject);
    this.onProgress = null;
  }
  get headersReady() {
    return this._headersCapability.promise;
  }
  get filename() {
    return this._filename;
  }
  get contentLength() {
    return this._contentLength;
  }
  get isRangeSupported() {
    return this._isRangeSupported;
  }
  get isStreamingSupported() {
    return this._isStreamingSupported;
  }
  async read() {
    await this._headersCapability.promise;
    const {
      value,
      done
    } = await this._reader.read();
    if (done) {
      return {
        value,
        done
      };
    }
    this._loaded += value.byteLength;
    this.onProgress?.({
      loaded: this._loaded,
      total: this._contentLength
    });
    return {
      value: getArrayBuffer(value),
      done: false
    };
  }
  cancel(reason) {
    this._reader?.cancel(reason);
    this._abortController.abort();
  }
};
var PDFFetchStreamRangeReader = class {
  constructor(stream, begin, end) {
    this._stream = stream;
    this._reader = null;
    this._loaded = 0;
    const source = stream.source;
    this._withCredentials = source.withCredentials || false;
    this._readCapability = Promise.withResolvers();
    this._isStreamingSupported = !source.disableStream;
    this._abortController = new AbortController();
    const headers = new Headers(stream.headers);
    headers.append("Range", `bytes=${begin}-${end - 1}`);
    const url = source.url;
    fetch(url, createFetchOptions(headers, this._withCredentials, this._abortController)).then((response) => {
      const responseOrigin = getResponseOrigin(response.url);
      if (responseOrigin !== stream._responseOrigin) {
        throw new Error(`Expected range response-origin "${responseOrigin}" to match "${stream._responseOrigin}".`);
      }
      if (!validateResponseStatus(response.status)) {
        throw createResponseStatusError(response.status, url);
      }
      this._readCapability.resolve();
      this._reader = response.body.getReader();
    }).catch(this._readCapability.reject);
    this.onProgress = null;
  }
  get isStreamingSupported() {
    return this._isStreamingSupported;
  }
  async read() {
    await this._readCapability.promise;
    const {
      value,
      done
    } = await this._reader.read();
    if (done) {
      return {
        value,
        done
      };
    }
    this._loaded += value.byteLength;
    this.onProgress?.({
      loaded: this._loaded
    });
    return {
      value: getArrayBuffer(value),
      done: false
    };
  }
  cancel(reason) {
    this._reader?.cancel(reason);
    this._abortController.abort();
  }
};
var OK_RESPONSE = 200;
var PARTIAL_CONTENT_RESPONSE = 206;
function network_getArrayBuffer(xhr) {
  const data = xhr.response;
  if (typeof data !== "string") {
    return data;
  }
  return stringToBytes(data).buffer;
}
var NetworkManager = class {
  _responseOrigin = null;
  constructor({
    url,
    httpHeaders,
    withCredentials
  }) {
    this.url = url;
    this.isHttp = /^https?:/i.test(url);
    this.headers = createHeaders(this.isHttp, httpHeaders);
    this.withCredentials = withCredentials || false;
    this.currXhrId = 0;
    this.pendingRequests = /* @__PURE__ */ Object.create(null);
  }
  request(args) {
    const xhr = new XMLHttpRequest();
    const xhrId = this.currXhrId++;
    const pendingRequest = this.pendingRequests[xhrId] = {
      xhr
    };
    xhr.open("GET", this.url);
    xhr.withCredentials = this.withCredentials;
    for (const [key, val] of this.headers) {
      xhr.setRequestHeader(key, val);
    }
    if (this.isHttp && "begin" in args && "end" in args) {
      xhr.setRequestHeader("Range", `bytes=${args.begin}-${args.end - 1}`);
      pendingRequest.expectedStatus = PARTIAL_CONTENT_RESPONSE;
    } else {
      pendingRequest.expectedStatus = OK_RESPONSE;
    }
    xhr.responseType = "arraybuffer";
    assert(args.onError, "Expected `onError` callback to be provided.");
    xhr.onerror = () => {
      args.onError(xhr.status);
    };
    xhr.onreadystatechange = this.onStateChange.bind(this, xhrId);
    xhr.onprogress = this.onProgress.bind(this, xhrId);
    pendingRequest.onHeadersReceived = args.onHeadersReceived;
    pendingRequest.onDone = args.onDone;
    pendingRequest.onError = args.onError;
    pendingRequest.onProgress = args.onProgress;
    xhr.send(null);
    return xhrId;
  }
  onProgress(xhrId, evt) {
    const pendingRequest = this.pendingRequests[xhrId];
    if (!pendingRequest) {
      return;
    }
    pendingRequest.onProgress?.(evt);
  }
  onStateChange(xhrId, evt) {
    const pendingRequest = this.pendingRequests[xhrId];
    if (!pendingRequest) {
      return;
    }
    const xhr = pendingRequest.xhr;
    if (xhr.readyState >= 2 && pendingRequest.onHeadersReceived) {
      pendingRequest.onHeadersReceived();
      delete pendingRequest.onHeadersReceived;
    }
    if (xhr.readyState !== 4) {
      return;
    }
    if (!(xhrId in this.pendingRequests)) {
      return;
    }
    delete this.pendingRequests[xhrId];
    if (xhr.status === 0 && this.isHttp) {
      pendingRequest.onError(xhr.status);
      return;
    }
    const xhrStatus = xhr.status || OK_RESPONSE;
    const ok_response_on_range_request = xhrStatus === OK_RESPONSE && pendingRequest.expectedStatus === PARTIAL_CONTENT_RESPONSE;
    if (!ok_response_on_range_request && xhrStatus !== pendingRequest.expectedStatus) {
      pendingRequest.onError(xhr.status);
      return;
    }
    const chunk = network_getArrayBuffer(xhr);
    if (xhrStatus === PARTIAL_CONTENT_RESPONSE) {
      const rangeHeader = xhr.getResponseHeader("Content-Range");
      const matches = /bytes (\d+)-(\d+)\/(\d+)/.exec(rangeHeader);
      if (matches) {
        pendingRequest.onDone({
          begin: parseInt(matches[1], 10),
          chunk
        });
      } else {
        warn(`Missing or invalid "Content-Range" header.`);
        pendingRequest.onError(0);
      }
    } else if (chunk) {
      pendingRequest.onDone({
        begin: 0,
        chunk
      });
    } else {
      pendingRequest.onError(xhr.status);
    }
  }
  getRequestXhr(xhrId) {
    return this.pendingRequests[xhrId].xhr;
  }
  isPendingRequest(xhrId) {
    return xhrId in this.pendingRequests;
  }
  abortRequest(xhrId) {
    const xhr = this.pendingRequests[xhrId].xhr;
    delete this.pendingRequests[xhrId];
    xhr.abort();
  }
};
var PDFNetworkStream = class {
  constructor(source) {
    this._source = source;
    this._manager = new NetworkManager(source);
    this._rangeChunkSize = source.rangeChunkSize;
    this._fullRequestReader = null;
    this._rangeRequestReaders = [];
  }
  _onRangeRequestReaderClosed(reader) {
    const i = this._rangeRequestReaders.indexOf(reader);
    if (i >= 0) {
      this._rangeRequestReaders.splice(i, 1);
    }
  }
  getFullReader() {
    assert(!this._fullRequestReader, "PDFNetworkStream.getFullReader can only be called once.");
    this._fullRequestReader = new PDFNetworkStreamFullRequestReader(this._manager, this._source);
    return this._fullRequestReader;
  }
  getRangeReader(begin, end) {
    const reader = new PDFNetworkStreamRangeRequestReader(this._manager, begin, end);
    reader.onClosed = this._onRangeRequestReaderClosed.bind(this);
    this._rangeRequestReaders.push(reader);
    return reader;
  }
  cancelAllRequests(reason) {
    this._fullRequestReader?.cancel(reason);
    for (const reader of this._rangeRequestReaders.slice(0)) {
      reader.cancel(reason);
    }
  }
};
var PDFNetworkStreamFullRequestReader = class {
  constructor(manager, source) {
    this._manager = manager;
    this._url = source.url;
    this._fullRequestId = manager.request({
      onHeadersReceived: this._onHeadersReceived.bind(this),
      onDone: this._onDone.bind(this),
      onError: this._onError.bind(this),
      onProgress: this._onProgress.bind(this)
    });
    this._headersCapability = Promise.withResolvers();
    this._disableRange = source.disableRange || false;
    this._contentLength = source.length;
    this._rangeChunkSize = source.rangeChunkSize;
    if (!this._rangeChunkSize && !this._disableRange) {
      this._disableRange = true;
    }
    this._isStreamingSupported = false;
    this._isRangeSupported = false;
    this._cachedChunks = [];
    this._requests = [];
    this._done = false;
    this._storedError = void 0;
    this._filename = null;
    this.onProgress = null;
  }
  _onHeadersReceived() {
    const fullRequestXhrId = this._fullRequestId;
    const fullRequestXhr = this._manager.getRequestXhr(fullRequestXhrId);
    this._manager._responseOrigin = getResponseOrigin(fullRequestXhr.responseURL);
    const rawResponseHeaders = fullRequestXhr.getAllResponseHeaders();
    const responseHeaders = new Headers(rawResponseHeaders ? rawResponseHeaders.trimStart().replace(/[^\S ]+$/, "").split(/[\r\n]+/).map((x) => {
      const [key, ...val] = x.split(": ");
      return [key, val.join(": ")];
    }) : []);
    const {
      allowRangeRequests,
      suggestedLength
    } = validateRangeRequestCapabilities({
      responseHeaders,
      isHttp: this._manager.isHttp,
      rangeChunkSize: this._rangeChunkSize,
      disableRange: this._disableRange
    });
    if (allowRangeRequests) {
      this._isRangeSupported = true;
    }
    this._contentLength = suggestedLength || this._contentLength;
    this._filename = extractFilenameFromHeader(responseHeaders);
    if (this._isRangeSupported) {
      this._manager.abortRequest(fullRequestXhrId);
    }
    this._headersCapability.resolve();
  }
  _onDone(data) {
    if (data) {
      if (this._requests.length > 0) {
        const requestCapability = this._requests.shift();
        requestCapability.resolve({
          value: data.chunk,
          done: false
        });
      } else {
        this._cachedChunks.push(data.chunk);
      }
    }
    this._done = true;
    if (this._cachedChunks.length > 0) {
      return;
    }
    for (const requestCapability of this._requests) {
      requestCapability.resolve({
        value: void 0,
        done: true
      });
    }
    this._requests.length = 0;
  }
  _onError(status) {
    this._storedError = createResponseStatusError(status, this._url);
    this._headersCapability.reject(this._storedError);
    for (const requestCapability of this._requests) {
      requestCapability.reject(this._storedError);
    }
    this._requests.length = 0;
    this._cachedChunks.length = 0;
  }
  _onProgress(evt) {
    this.onProgress?.({
      loaded: evt.loaded,
      total: evt.lengthComputable ? evt.total : this._contentLength
    });
  }
  get filename() {
    return this._filename;
  }
  get isRangeSupported() {
    return this._isRangeSupported;
  }
  get isStreamingSupported() {
    return this._isStreamingSupported;
  }
  get contentLength() {
    return this._contentLength;
  }
  get headersReady() {
    return this._headersCapability.promise;
  }
  async read() {
    await this._headersCapability.promise;
    if (this._storedError) {
      throw this._storedError;
    }
    if (this._cachedChunks.length > 0) {
      const chunk = this._cachedChunks.shift();
      return {
        value: chunk,
        done: false
      };
    }
    if (this._done) {
      return {
        value: void 0,
        done: true
      };
    }
    const requestCapability = Promise.withResolvers();
    this._requests.push(requestCapability);
    return requestCapability.promise;
  }
  cancel(reason) {
    this._done = true;
    this._headersCapability.reject(reason);
    for (const requestCapability of this._requests) {
      requestCapability.resolve({
        value: void 0,
        done: true
      });
    }
    this._requests.length = 0;
    if (this._manager.isPendingRequest(this._fullRequestId)) {
      this._manager.abortRequest(this._fullRequestId);
    }
    this._fullRequestReader = null;
  }
};
var PDFNetworkStreamRangeRequestReader = class {
  constructor(manager, begin, end) {
    this._manager = manager;
    this._url = manager.url;
    this._requestId = manager.request({
      begin,
      end,
      onHeadersReceived: this._onHeadersReceived.bind(this),
      onDone: this._onDone.bind(this),
      onError: this._onError.bind(this),
      onProgress: this._onProgress.bind(this)
    });
    this._requests = [];
    this._queuedChunk = null;
    this._done = false;
    this._storedError = void 0;
    this.onProgress = null;
    this.onClosed = null;
  }
  _onHeadersReceived() {
    const responseOrigin = getResponseOrigin(this._manager.getRequestXhr(this._requestId)?.responseURL);
    if (responseOrigin !== this._manager._responseOrigin) {
      this._storedError = new Error(`Expected range response-origin "${responseOrigin}" to match "${this._manager._responseOrigin}".`);
      this._onError(0);
    }
  }
  _close() {
    this.onClosed?.(this);
  }
  _onDone(data) {
    const chunk = data.chunk;
    if (this._requests.length > 0) {
      const requestCapability = this._requests.shift();
      requestCapability.resolve({
        value: chunk,
        done: false
      });
    } else {
      this._queuedChunk = chunk;
    }
    this._done = true;
    for (const requestCapability of this._requests) {
      requestCapability.resolve({
        value: void 0,
        done: true
      });
    }
    this._requests.length = 0;
    this._close();
  }
  _onError(status) {
    this._storedError ??= createResponseStatusError(status, this._url);
    for (const requestCapability of this._requests) {
      requestCapability.reject(this._storedError);
    }
    this._requests.length = 0;
    this._queuedChunk = null;
  }
  _onProgress(evt) {
    if (!this.isStreamingSupported) {
      this.onProgress?.({
        loaded: evt.loaded
      });
    }
  }
  get isStreamingSupported() {
    return false;
  }
  async read() {
    if (this._storedError) {
      throw this._storedError;
    }
    if (this._queuedChunk !== null) {
      const chunk = this._queuedChunk;
      this._queuedChunk = null;
      return {
        value: chunk,
        done: false
      };
    }
    if (this._done) {
      return {
        value: void 0,
        done: true
      };
    }
    const requestCapability = Promise.withResolvers();
    this._requests.push(requestCapability);
    return requestCapability.promise;
  }
  cancel(reason) {
    this._done = true;
    for (const requestCapability of this._requests) {
      requestCapability.resolve({
        value: void 0,
        done: true
      });
    }
    this._requests.length = 0;
    if (this._manager.isPendingRequest(this._requestId)) {
      this._manager.abortRequest(this._requestId);
    }
    this._close();
  }
};
var urlRegex = /^[a-z][a-z0-9\-+.]+:/i;
function parseUrlOrPath(sourceUrl2) {
  if (urlRegex.test(sourceUrl2)) {
    return new URL(sourceUrl2);
  }
  const url = process.getBuiltinModule("url");
  return new URL(url.pathToFileURL(sourceUrl2));
}
var PDFNodeStream = class {
  constructor(source) {
    this.source = source;
    this.url = parseUrlOrPath(source.url);
    assert(this.url.protocol === "file:", "PDFNodeStream only supports file:// URLs.");
    this._fullRequestReader = null;
    this._rangeRequestReaders = [];
  }
  get _progressiveDataLength() {
    return this._fullRequestReader?._loaded ?? 0;
  }
  getFullReader() {
    assert(!this._fullRequestReader, "PDFNodeStream.getFullReader can only be called once.");
    this._fullRequestReader = new PDFNodeStreamFsFullReader(this);
    return this._fullRequestReader;
  }
  getRangeReader(start, end) {
    if (end <= this._progressiveDataLength) {
      return null;
    }
    const rangeReader = new PDFNodeStreamFsRangeReader(this, start, end);
    this._rangeRequestReaders.push(rangeReader);
    return rangeReader;
  }
  cancelAllRequests(reason) {
    this._fullRequestReader?.cancel(reason);
    for (const reader of this._rangeRequestReaders.slice(0)) {
      reader.cancel(reason);
    }
  }
};
var PDFNodeStreamFsFullReader = class {
  constructor(stream) {
    this._url = stream.url;
    this._done = false;
    this._storedError = null;
    this.onProgress = null;
    const source = stream.source;
    this._contentLength = source.length;
    this._loaded = 0;
    this._filename = null;
    this._disableRange = source.disableRange || false;
    this._rangeChunkSize = source.rangeChunkSize;
    if (!this._rangeChunkSize && !this._disableRange) {
      this._disableRange = true;
    }
    this._isStreamingSupported = !source.disableStream;
    this._isRangeSupported = !source.disableRange;
    this._readableStream = null;
    this._readCapability = Promise.withResolvers();
    this._headersCapability = Promise.withResolvers();
    const fs = process.getBuiltinModule("fs");
    fs.promises.lstat(this._url).then((stat) => {
      this._contentLength = stat.size;
      this._setReadableStream(fs.createReadStream(this._url));
      this._headersCapability.resolve();
    }, (error) => {
      if (error.code === "ENOENT") {
        error = new MissingPDFException(`Missing PDF "${this._url}".`);
      }
      this._storedError = error;
      this._headersCapability.reject(error);
    });
  }
  get headersReady() {
    return this._headersCapability.promise;
  }
  get filename() {
    return this._filename;
  }
  get contentLength() {
    return this._contentLength;
  }
  get isRangeSupported() {
    return this._isRangeSupported;
  }
  get isStreamingSupported() {
    return this._isStreamingSupported;
  }
  async read() {
    await this._readCapability.promise;
    if (this._done) {
      return {
        value: void 0,
        done: true
      };
    }
    if (this._storedError) {
      throw this._storedError;
    }
    const chunk = this._readableStream.read();
    if (chunk === null) {
      this._readCapability = Promise.withResolvers();
      return this.read();
    }
    this._loaded += chunk.length;
    this.onProgress?.({
      loaded: this._loaded,
      total: this._contentLength
    });
    const buffer = new Uint8Array(chunk).buffer;
    return {
      value: buffer,
      done: false
    };
  }
  cancel(reason) {
    if (!this._readableStream) {
      this._error(reason);
      return;
    }
    this._readableStream.destroy(reason);
  }
  _error(reason) {
    this._storedError = reason;
    this._readCapability.resolve();
  }
  _setReadableStream(readableStream) {
    this._readableStream = readableStream;
    readableStream.on("readable", () => {
      this._readCapability.resolve();
    });
    readableStream.on("end", () => {
      readableStream.destroy();
      this._done = true;
      this._readCapability.resolve();
    });
    readableStream.on("error", (reason) => {
      this._error(reason);
    });
    if (!this._isStreamingSupported && this._isRangeSupported) {
      this._error(new AbortException("streaming is disabled"));
    }
    if (this._storedError) {
      this._readableStream.destroy(this._storedError);
    }
  }
};
var PDFNodeStreamFsRangeReader = class {
  constructor(stream, start, end) {
    this._url = stream.url;
    this._done = false;
    this._storedError = null;
    this.onProgress = null;
    this._loaded = 0;
    this._readableStream = null;
    this._readCapability = Promise.withResolvers();
    const source = stream.source;
    this._isStreamingSupported = !source.disableStream;
    const fs = process.getBuiltinModule("fs");
    this._setReadableStream(fs.createReadStream(this._url, {
      start,
      end: end - 1
    }));
  }
  get isStreamingSupported() {
    return this._isStreamingSupported;
  }
  async read() {
    await this._readCapability.promise;
    if (this._done) {
      return {
        value: void 0,
        done: true
      };
    }
    if (this._storedError) {
      throw this._storedError;
    }
    const chunk = this._readableStream.read();
    if (chunk === null) {
      this._readCapability = Promise.withResolvers();
      return this.read();
    }
    this._loaded += chunk.length;
    this.onProgress?.({
      loaded: this._loaded
    });
    const buffer = new Uint8Array(chunk).buffer;
    return {
      value: buffer,
      done: false
    };
  }
  cancel(reason) {
    if (!this._readableStream) {
      this._error(reason);
      return;
    }
    this._readableStream.destroy(reason);
  }
  _error(reason) {
    this._storedError = reason;
    this._readCapability.resolve();
  }
  _setReadableStream(readableStream) {
    this._readableStream = readableStream;
    readableStream.on("readable", () => {
      this._readCapability.resolve();
    });
    readableStream.on("end", () => {
      readableStream.destroy();
      this._done = true;
      this._readCapability.resolve();
    });
    readableStream.on("error", (reason) => {
      this._error(reason);
    });
    if (this._storedError) {
      this._readableStream.destroy(this._storedError);
    }
  }
};
var MAX_TEXT_DIVS_TO_RENDER = 1e5;
var DEFAULT_FONT_SIZE = 30;
var DEFAULT_FONT_ASCENT = 0.8;
var TextLayer = class _TextLayer {
  #capability = Promise.withResolvers();
  #container = null;
  #disableProcessItems = false;
  #fontInspectorEnabled = !!globalThis.FontInspector?.enabled;
  #lang = null;
  #layoutTextParams = null;
  #pageHeight = 0;
  #pageWidth = 0;
  #reader = null;
  #rootContainer = null;
  #rotation = 0;
  #scale = 0;
  #styleCache = /* @__PURE__ */ Object.create(null);
  #textContentItemsStr = [];
  #textContentSource = null;
  #textDivs = [];
  #textDivProperties = /* @__PURE__ */ new WeakMap();
  #transform = null;
  static #ascentCache = /* @__PURE__ */ new Map();
  static #canvasContexts = /* @__PURE__ */ new Map();
  static #canvasCtxFonts = /* @__PURE__ */ new WeakMap();
  static #minFontSize = null;
  static #pendingTextLayers = /* @__PURE__ */ new Set();
  constructor({
    textContentSource,
    container,
    viewport
  }) {
    if (textContentSource instanceof ReadableStream) {
      this.#textContentSource = textContentSource;
    } else if (typeof textContentSource === "object") {
      this.#textContentSource = new ReadableStream({
        start(controller) {
          controller.enqueue(textContentSource);
          controller.close();
        }
      });
    } else {
      throw new Error('No "textContentSource" parameter specified.');
    }
    this.#container = this.#rootContainer = container;
    this.#scale = viewport.scale * (globalThis.devicePixelRatio || 1);
    this.#rotation = viewport.rotation;
    this.#layoutTextParams = {
      div: null,
      properties: null,
      ctx: null
    };
    const {
      pageWidth,
      pageHeight,
      pageX,
      pageY
    } = viewport.rawDims;
    this.#transform = [1, 0, 0, -1, -pageX, pageY + pageHeight];
    this.#pageWidth = pageWidth;
    this.#pageHeight = pageHeight;
    _TextLayer.#ensureMinFontSizeComputed();
    setLayerDimensions(container, viewport);
    this.#capability.promise.finally(() => {
      _TextLayer.#pendingTextLayers.delete(this);
      this.#layoutTextParams = null;
      this.#styleCache = null;
    }).catch(() => {
    });
  }
  static get fontFamilyMap() {
    const {
      isWindows,
      isFirefox
    } = util_FeatureTest.platform;
    return shadow(this, "fontFamilyMap", /* @__PURE__ */ new Map([["sans-serif", `${isWindows && isFirefox ? "Calibri, " : ""}sans-serif`], ["monospace", `${isWindows && isFirefox ? "Lucida Console, " : ""}monospace`]]));
  }
  render() {
    const pump = () => {
      this.#reader.read().then(({
        value,
        done
      }) => {
        if (done) {
          this.#capability.resolve();
          return;
        }
        this.#lang ??= value.lang;
        Object.assign(this.#styleCache, value.styles);
        this.#processItems(value.items);
        pump();
      }, this.#capability.reject);
    };
    this.#reader = this.#textContentSource.getReader();
    _TextLayer.#pendingTextLayers.add(this);
    pump();
    return this.#capability.promise;
  }
  update({
    viewport,
    onBefore = null
  }) {
    const scale = viewport.scale * (globalThis.devicePixelRatio || 1);
    const rotation = viewport.rotation;
    if (rotation !== this.#rotation) {
      onBefore?.();
      this.#rotation = rotation;
      setLayerDimensions(this.#rootContainer, {
        rotation
      });
    }
    if (scale !== this.#scale) {
      onBefore?.();
      this.#scale = scale;
      const params = {
        div: null,
        properties: null,
        ctx: _TextLayer.#getCtx(this.#lang)
      };
      for (const div of this.#textDivs) {
        params.properties = this.#textDivProperties.get(div);
        params.div = div;
        this.#layout(params);
      }
    }
  }
  cancel() {
    const abortEx = new AbortException("TextLayer task cancelled.");
    this.#reader?.cancel(abortEx).catch(() => {
    });
    this.#reader = null;
    this.#capability.reject(abortEx);
  }
  get textDivs() {
    return this.#textDivs;
  }
  get textContentItemsStr() {
    return this.#textContentItemsStr;
  }
  #processItems(items) {
    if (this.#disableProcessItems) {
      return;
    }
    this.#layoutTextParams.ctx ??= _TextLayer.#getCtx(this.#lang);
    const textDivs = this.#textDivs, textContentItemsStr = this.#textContentItemsStr;
    for (const item of items) {
      if (textDivs.length > MAX_TEXT_DIVS_TO_RENDER) {
        warn("Ignoring additional textDivs for performance reasons.");
        this.#disableProcessItems = true;
        return;
      }
      if (item.str === void 0) {
        if (item.type === "beginMarkedContentProps" || item.type === "beginMarkedContent") {
          const parent = this.#container;
          this.#container = document.createElement("span");
          this.#container.classList.add("markedContent");
          if (item.id !== null) {
            this.#container.setAttribute("id", `${item.id}`);
          }
          parent.append(this.#container);
        } else if (item.type === "endMarkedContent") {
          this.#container = this.#container.parentNode;
        }
        continue;
      }
      textContentItemsStr.push(item.str);
      this.#appendText(item);
    }
  }
  #appendText(geom) {
    const textDiv = document.createElement("span");
    const textDivProperties = {
      angle: 0,
      canvasWidth: 0,
      hasText: geom.str !== "",
      hasEOL: geom.hasEOL,
      fontSize: 0
    };
    this.#textDivs.push(textDiv);
    const tx = Util.transform(this.#transform, geom.transform);
    let angle = Math.atan2(tx[1], tx[0]);
    const style = this.#styleCache[geom.fontName];
    if (style.vertical) {
      angle += Math.PI / 2;
    }
    let fontFamily = this.#fontInspectorEnabled && style.fontSubstitution || style.fontFamily;
    fontFamily = _TextLayer.fontFamilyMap.get(fontFamily) || fontFamily;
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const fontAscent = fontHeight * _TextLayer.#getAscent(fontFamily, this.#lang);
    let left, top;
    if (angle === 0) {
      left = tx[4];
      top = tx[5] - fontAscent;
    } else {
      left = tx[4] + fontAscent * Math.sin(angle);
      top = tx[5] - fontAscent * Math.cos(angle);
    }
    const scaleFactorStr = "calc(var(--scale-factor)*";
    const divStyle = textDiv.style;
    if (this.#container === this.#rootContainer) {
      divStyle.left = `${(100 * left / this.#pageWidth).toFixed(2)}%`;
      divStyle.top = `${(100 * top / this.#pageHeight).toFixed(2)}%`;
    } else {
      divStyle.left = `${scaleFactorStr}${left.toFixed(2)}px)`;
      divStyle.top = `${scaleFactorStr}${top.toFixed(2)}px)`;
    }
    divStyle.fontSize = `${scaleFactorStr}${(_TextLayer.#minFontSize * fontHeight).toFixed(2)}px)`;
    divStyle.fontFamily = fontFamily;
    textDivProperties.fontSize = fontHeight;
    textDiv.setAttribute("role", "presentation");
    textDiv.textContent = geom.str;
    textDiv.dir = geom.dir;
    if (this.#fontInspectorEnabled) {
      textDiv.dataset.fontName = style.fontSubstitutionLoadedName || geom.fontName;
    }
    if (angle !== 0) {
      textDivProperties.angle = angle * (180 / Math.PI);
    }
    let shouldScaleText = false;
    if (geom.str.length > 1) {
      shouldScaleText = true;
    } else if (geom.str !== " " && geom.transform[0] !== geom.transform[3]) {
      const absScaleX = Math.abs(geom.transform[0]), absScaleY = Math.abs(geom.transform[3]);
      if (absScaleX !== absScaleY && Math.max(absScaleX, absScaleY) / Math.min(absScaleX, absScaleY) > 1.5) {
        shouldScaleText = true;
      }
    }
    if (shouldScaleText) {
      textDivProperties.canvasWidth = style.vertical ? geom.height : geom.width;
    }
    this.#textDivProperties.set(textDiv, textDivProperties);
    this.#layoutTextParams.div = textDiv;
    this.#layoutTextParams.properties = textDivProperties;
    this.#layout(this.#layoutTextParams);
    if (textDivProperties.hasText) {
      this.#container.append(textDiv);
    }
    if (textDivProperties.hasEOL) {
      const br = document.createElement("br");
      br.setAttribute("role", "presentation");
      this.#container.append(br);
    }
  }
  #layout(params) {
    const {
      div,
      properties,
      ctx
    } = params;
    const {
      style
    } = div;
    let transform = "";
    if (_TextLayer.#minFontSize > 1) {
      transform = `scale(${1 / _TextLayer.#minFontSize})`;
    }
    if (properties.canvasWidth !== 0 && properties.hasText) {
      const {
        fontFamily
      } = style;
      const {
        canvasWidth,
        fontSize
      } = properties;
      _TextLayer.#ensureCtxFont(ctx, fontSize * this.#scale, fontFamily);
      const {
        width
      } = ctx.measureText(div.textContent);
      if (width > 0) {
        transform = `scaleX(${canvasWidth * this.#scale / width}) ${transform}`;
      }
    }
    if (properties.angle !== 0) {
      transform = `rotate(${properties.angle}deg) ${transform}`;
    }
    if (transform.length > 0) {
      style.transform = transform;
    }
  }
  static cleanup() {
    if (this.#pendingTextLayers.size > 0) {
      return;
    }
    this.#ascentCache.clear();
    for (const {
      canvas
    } of this.#canvasContexts.values()) {
      canvas.remove();
    }
    this.#canvasContexts.clear();
  }
  static #getCtx(lang = null) {
    let ctx = this.#canvasContexts.get(lang ||= "");
    if (!ctx) {
      const canvas = document.createElement("canvas");
      canvas.className = "hiddenCanvasElement";
      canvas.lang = lang;
      document.body.append(canvas);
      ctx = canvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true
      });
      this.#canvasContexts.set(lang, ctx);
      this.#canvasCtxFonts.set(ctx, {
        size: 0,
        family: ""
      });
    }
    return ctx;
  }
  static #ensureCtxFont(ctx, size, family) {
    const cached = this.#canvasCtxFonts.get(ctx);
    if (size === cached.size && family === cached.family) {
      return;
    }
    ctx.font = `${size}px ${family}`;
    cached.size = size;
    cached.family = family;
  }
  static #ensureMinFontSizeComputed() {
    if (this.#minFontSize !== null) {
      return;
    }
    const div = document.createElement("div");
    div.style.opacity = 0;
    div.style.lineHeight = 1;
    div.style.fontSize = "1px";
    div.style.position = "absolute";
    div.textContent = "X";
    document.body.append(div);
    this.#minFontSize = div.getBoundingClientRect().height;
    div.remove();
  }
  static #getAscent(fontFamily, lang) {
    const cachedAscent = this.#ascentCache.get(fontFamily);
    if (cachedAscent) {
      return cachedAscent;
    }
    const ctx = this.#getCtx(lang);
    ctx.canvas.width = ctx.canvas.height = DEFAULT_FONT_SIZE;
    this.#ensureCtxFont(ctx, DEFAULT_FONT_SIZE, fontFamily);
    const metrics = ctx.measureText("");
    let ascent = metrics.fontBoundingBoxAscent;
    let descent = Math.abs(metrics.fontBoundingBoxDescent);
    if (ascent) {
      const ratio2 = ascent / (ascent + descent);
      this.#ascentCache.set(fontFamily, ratio2);
      ctx.canvas.width = ctx.canvas.height = 0;
      return ratio2;
    }
    ctx.strokeStyle = "red";
    ctx.clearRect(0, 0, DEFAULT_FONT_SIZE, DEFAULT_FONT_SIZE);
    ctx.strokeText("g", 0, 0);
    let pixels = ctx.getImageData(0, 0, DEFAULT_FONT_SIZE, DEFAULT_FONT_SIZE).data;
    descent = 0;
    for (let i = pixels.length - 1 - 3; i >= 0; i -= 4) {
      if (pixels[i] > 0) {
        descent = Math.ceil(i / 4 / DEFAULT_FONT_SIZE);
        break;
      }
    }
    ctx.clearRect(0, 0, DEFAULT_FONT_SIZE, DEFAULT_FONT_SIZE);
    ctx.strokeText("A", 0, DEFAULT_FONT_SIZE);
    pixels = ctx.getImageData(0, 0, DEFAULT_FONT_SIZE, DEFAULT_FONT_SIZE).data;
    ascent = 0;
    for (let i = 0, ii = pixels.length; i < ii; i += 4) {
      if (pixels[i] > 0) {
        ascent = DEFAULT_FONT_SIZE - Math.floor(i / 4 / DEFAULT_FONT_SIZE);
        break;
      }
    }
    ctx.canvas.width = ctx.canvas.height = 0;
    const ratio = ascent ? ascent / (ascent + descent) : DEFAULT_FONT_ASCENT;
    this.#ascentCache.set(fontFamily, ratio);
    return ratio;
  }
};
var XfaText = class _XfaText {
  static textContent(xfa) {
    const items = [];
    const output = {
      items,
      styles: /* @__PURE__ */ Object.create(null)
    };
    function walk(node) {
      if (!node) {
        return;
      }
      let str = null;
      const name = node.name;
      if (name === "#text") {
        str = node.value;
      } else if (!_XfaText.shouldBuildText(name)) {
        return;
      } else if (node?.attributes?.textContent) {
        str = node.attributes.textContent;
      } else if (node.value) {
        str = node.value;
      }
      if (str !== null) {
        items.push({
          str
        });
      }
      if (!node.children) {
        return;
      }
      for (const child of node.children) {
        walk(child);
      }
    }
    walk(xfa);
    return output;
  }
  static shouldBuildText(name) {
    return !(name === "textarea" || name === "input" || name === "option" || name === "select");
  }
};
var DEFAULT_RANGE_CHUNK_SIZE = 65536;
var RENDERING_CANCELLED_TIMEOUT = 100;
var DELAYED_CLEANUP_TIMEOUT = 5e3;
var DefaultCanvasFactory = isNodeJS ? NodeCanvasFactory : DOMCanvasFactory;
var DefaultCMapReaderFactory = isNodeJS ? NodeCMapReaderFactory : DOMCMapReaderFactory;
var DefaultFilterFactory = isNodeJS ? NodeFilterFactory : DOMFilterFactory;
var DefaultStandardFontDataFactory = isNodeJS ? NodeStandardFontDataFactory : DOMStandardFontDataFactory;
function getDocument(src = {}) {
  if (typeof src === "string" || src instanceof URL) {
    src = {
      url: src
    };
  } else if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) {
    src = {
      data: src
    };
  }
  const task = new PDFDocumentLoadingTask();
  const {
    docId
  } = task;
  const url = src.url ? getUrlProp(src.url) : null;
  const data = src.data ? getDataProp(src.data) : null;
  const httpHeaders = src.httpHeaders || null;
  const withCredentials = src.withCredentials === true;
  const password = src.password ?? null;
  const rangeTransport = src.range instanceof PDFDataRangeTransport ? src.range : null;
  const rangeChunkSize = Number.isInteger(src.rangeChunkSize) && src.rangeChunkSize > 0 ? src.rangeChunkSize : DEFAULT_RANGE_CHUNK_SIZE;
  let worker = src.worker instanceof PDFWorker ? src.worker : null;
  const verbosity2 = src.verbosity;
  const docBaseUrl = typeof src.docBaseUrl === "string" && !isDataScheme(src.docBaseUrl) ? src.docBaseUrl : null;
  const cMapUrl = typeof src.cMapUrl === "string" ? src.cMapUrl : null;
  const cMapPacked = src.cMapPacked !== false;
  const CMapReaderFactory = src.CMapReaderFactory || DefaultCMapReaderFactory;
  const standardFontDataUrl = typeof src.standardFontDataUrl === "string" ? src.standardFontDataUrl : null;
  const StandardFontDataFactory = src.StandardFontDataFactory || DefaultStandardFontDataFactory;
  const ignoreErrors = src.stopAtErrors !== true;
  const maxImageSize = Number.isInteger(src.maxImageSize) && src.maxImageSize > -1 ? src.maxImageSize : -1;
  const isEvalSupported2 = src.isEvalSupported !== false;
  const isOffscreenCanvasSupported = typeof src.isOffscreenCanvasSupported === "boolean" ? src.isOffscreenCanvasSupported : !isNodeJS;
  const isImageDecoderSupported = typeof src.isImageDecoderSupported === "boolean" ? src.isImageDecoderSupported : !isNodeJS && (util_FeatureTest.platform.isFirefox || !globalThis.chrome);
  const canvasMaxAreaInBytes = Number.isInteger(src.canvasMaxAreaInBytes) ? src.canvasMaxAreaInBytes : -1;
  const disableFontFace = typeof src.disableFontFace === "boolean" ? src.disableFontFace : isNodeJS;
  const fontExtraProperties = src.fontExtraProperties === true;
  const enableXfa = src.enableXfa === true;
  const ownerDocument = src.ownerDocument || globalThis.document;
  const disableRange = src.disableRange === true;
  const disableStream = src.disableStream === true;
  const disableAutoFetch = src.disableAutoFetch === true;
  const pdfBug = src.pdfBug === true;
  const CanvasFactory = src.CanvasFactory || DefaultCanvasFactory;
  const FilterFactory = src.FilterFactory || DefaultFilterFactory;
  const enableHWA = src.enableHWA === true;
  const length = rangeTransport ? rangeTransport.length : src.length ?? NaN;
  const useSystemFonts = typeof src.useSystemFonts === "boolean" ? src.useSystemFonts : !isNodeJS && !disableFontFace;
  const useWorkerFetch = typeof src.useWorkerFetch === "boolean" ? src.useWorkerFetch : CMapReaderFactory === DOMCMapReaderFactory && StandardFontDataFactory === DOMStandardFontDataFactory && cMapUrl && standardFontDataUrl && isValidFetchUrl(cMapUrl, document.baseURI) && isValidFetchUrl(standardFontDataUrl, document.baseURI);
  const styleElement = null;
  setVerbosityLevel(verbosity2);
  const transportFactory = {
    canvasFactory: new CanvasFactory({
      ownerDocument,
      enableHWA
    }),
    filterFactory: new FilterFactory({
      docId,
      ownerDocument
    }),
    cMapReaderFactory: useWorkerFetch ? null : new CMapReaderFactory({
      baseUrl: cMapUrl,
      isCompressed: cMapPacked
    }),
    standardFontDataFactory: useWorkerFetch ? null : new StandardFontDataFactory({
      baseUrl: standardFontDataUrl
    })
  };
  if (!worker) {
    const workerParams = {
      verbosity: verbosity2,
      port: GlobalWorkerOptions.workerPort
    };
    worker = workerParams.port ? PDFWorker.fromPort(workerParams) : new PDFWorker(workerParams);
    task._worker = worker;
  }
  const docParams = {
    docId,
    apiVersion: "4.10.38",
    data,
    password,
    disableAutoFetch,
    rangeChunkSize,
    length,
    docBaseUrl,
    enableXfa,
    evaluatorOptions: {
      maxImageSize,
      disableFontFace,
      ignoreErrors,
      isEvalSupported: isEvalSupported2,
      isOffscreenCanvasSupported,
      isImageDecoderSupported,
      canvasMaxAreaInBytes,
      fontExtraProperties,
      useSystemFonts,
      cMapUrl: useWorkerFetch ? cMapUrl : null,
      standardFontDataUrl: useWorkerFetch ? standardFontDataUrl : null
    }
  };
  const transportParams = {
    disableFontFace,
    fontExtraProperties,
    ownerDocument,
    pdfBug,
    styleElement,
    loadingParams: {
      disableAutoFetch,
      enableXfa
    }
  };
  worker.promise.then(function() {
    if (task.destroyed) {
      throw new Error("Loading aborted");
    }
    if (worker.destroyed) {
      throw new Error("Worker was destroyed");
    }
    const workerIdPromise = worker.messageHandler.sendWithPromise("GetDocRequest", docParams, data ? [data.buffer] : null);
    let networkStream;
    if (rangeTransport) {
      networkStream = new PDFDataTransportStream(rangeTransport, {
        disableRange,
        disableStream
      });
    } else if (!data) {
      if (!url) {
        throw new Error("getDocument - no `url` parameter provided.");
      }
      let NetworkStream;
      if (isNodeJS) {
        if (isValidFetchUrl(url)) {
          if (typeof fetch === "undefined" || typeof Response === "undefined" || !("body" in Response.prototype)) {
            throw new Error("getDocument - the Fetch API was disabled in Node.js, see `--no-experimental-fetch`.");
          }
          NetworkStream = PDFFetchStream;
        } else {
          NetworkStream = PDFNodeStream;
        }
      } else {
        NetworkStream = isValidFetchUrl(url) ? PDFFetchStream : PDFNetworkStream;
      }
      networkStream = new NetworkStream({
        url,
        length,
        httpHeaders,
        withCredentials,
        rangeChunkSize,
        disableRange,
        disableStream
      });
    }
    return workerIdPromise.then((workerId) => {
      if (task.destroyed) {
        throw new Error("Loading aborted");
      }
      if (worker.destroyed) {
        throw new Error("Worker was destroyed");
      }
      const messageHandler = new MessageHandler(docId, workerId, worker.port);
      const transport = new WorkerTransport(messageHandler, task, networkStream, transportParams, transportFactory);
      task._transport = transport;
      messageHandler.send("Ready", null);
    });
  }).catch(task._capability.reject);
  return task;
}
function getUrlProp(val) {
  if (val instanceof URL) {
    return val.href;
  }
  try {
    return new URL(val, window.location).href;
  } catch {
    if (isNodeJS && typeof val === "string") {
      return val;
    }
  }
  throw new Error("Invalid PDF url data: either string or URL-object is expected in the url property.");
}
function getDataProp(val) {
  if (isNodeJS && typeof Buffer !== "undefined" && val instanceof Buffer) {
    throw new Error("Please provide binary data as `Uint8Array`, rather than `Buffer`.");
  }
  if (val instanceof Uint8Array && val.byteLength === val.buffer.byteLength) {
    return val;
  }
  if (typeof val === "string") {
    return stringToBytes(val);
  }
  if (val instanceof ArrayBuffer || ArrayBuffer.isView(val) || typeof val === "object" && !isNaN(val?.length)) {
    return new Uint8Array(val);
  }
  throw new Error("Invalid PDF binary data: either TypedArray, string, or array-like object is expected in the data property.");
}
function isRefProxy(ref) {
  return typeof ref === "object" && Number.isInteger(ref?.num) && ref.num >= 0 && Number.isInteger(ref?.gen) && ref.gen >= 0;
}
var PDFDocumentLoadingTask = class _PDFDocumentLoadingTask {
  static #docId = 0;
  constructor() {
    this._capability = Promise.withResolvers();
    this._transport = null;
    this._worker = null;
    this.docId = `d${_PDFDocumentLoadingTask.#docId++}`;
    this.destroyed = false;
    this.onPassword = null;
    this.onProgress = null;
  }
  get promise() {
    return this._capability.promise;
  }
  async destroy() {
    this.destroyed = true;
    try {
      if (this._worker?.port) {
        this._worker._pendingDestroy = true;
      }
      await this._transport?.destroy();
    } catch (ex) {
      if (this._worker?.port) {
        delete this._worker._pendingDestroy;
      }
      throw ex;
    }
    this._transport = null;
    this._worker?.destroy();
    this._worker = null;
  }
};
var PDFDataRangeTransport = class {
  constructor(length, initialData, progressiveDone = false, contentDispositionFilename = null) {
    this.length = length;
    this.initialData = initialData;
    this.progressiveDone = progressiveDone;
    this.contentDispositionFilename = contentDispositionFilename;
    this._rangeListeners = [];
    this._progressListeners = [];
    this._progressiveReadListeners = [];
    this._progressiveDoneListeners = [];
    this._readyCapability = Promise.withResolvers();
  }
  addRangeListener(listener) {
    this._rangeListeners.push(listener);
  }
  addProgressListener(listener) {
    this._progressListeners.push(listener);
  }
  addProgressiveReadListener(listener) {
    this._progressiveReadListeners.push(listener);
  }
  addProgressiveDoneListener(listener) {
    this._progressiveDoneListeners.push(listener);
  }
  onDataRange(begin, chunk) {
    for (const listener of this._rangeListeners) {
      listener(begin, chunk);
    }
  }
  onDataProgress(loaded, total) {
    this._readyCapability.promise.then(() => {
      for (const listener of this._progressListeners) {
        listener(loaded, total);
      }
    });
  }
  onDataProgressiveRead(chunk) {
    this._readyCapability.promise.then(() => {
      for (const listener of this._progressiveReadListeners) {
        listener(chunk);
      }
    });
  }
  onDataProgressiveDone() {
    this._readyCapability.promise.then(() => {
      for (const listener of this._progressiveDoneListeners) {
        listener();
      }
    });
  }
  transportReady() {
    this._readyCapability.resolve();
  }
  requestDataRange(begin, end) {
    unreachable("Abstract method PDFDataRangeTransport.requestDataRange");
  }
  abort() {
  }
};
var PDFDocumentProxy = class {
  constructor(pdfInfo, transport) {
    this._pdfInfo = pdfInfo;
    this._transport = transport;
  }
  get annotationStorage() {
    return this._transport.annotationStorage;
  }
  get canvasFactory() {
    return this._transport.canvasFactory;
  }
  get filterFactory() {
    return this._transport.filterFactory;
  }
  get numPages() {
    return this._pdfInfo.numPages;
  }
  get fingerprints() {
    return this._pdfInfo.fingerprints;
  }
  get isPureXfa() {
    return shadow(this, "isPureXfa", !!this._transport._htmlForXfa);
  }
  get allXfaHtml() {
    return this._transport._htmlForXfa;
  }
  getPage(pageNumber) {
    return this._transport.getPage(pageNumber);
  }
  getPageIndex(ref) {
    return this._transport.getPageIndex(ref);
  }
  getDestinations() {
    return this._transport.getDestinations();
  }
  getDestination(id) {
    return this._transport.getDestination(id);
  }
  getPageLabels() {
    return this._transport.getPageLabels();
  }
  getPageLayout() {
    return this._transport.getPageLayout();
  }
  getPageMode() {
    return this._transport.getPageMode();
  }
  getViewerPreferences() {
    return this._transport.getViewerPreferences();
  }
  getOpenAction() {
    return this._transport.getOpenAction();
  }
  getAttachments() {
    return this._transport.getAttachments();
  }
  getJSActions() {
    return this._transport.getDocJSActions();
  }
  getOutline() {
    return this._transport.getOutline();
  }
  getOptionalContentConfig({
    intent = "display"
  } = {}) {
    const {
      renderingIntent
    } = this._transport.getRenderingIntent(intent);
    return this._transport.getOptionalContentConfig(renderingIntent);
  }
  getPermissions() {
    return this._transport.getPermissions();
  }
  getMetadata() {
    return this._transport.getMetadata();
  }
  getMarkInfo() {
    return this._transport.getMarkInfo();
  }
  getData() {
    return this._transport.getData();
  }
  saveDocument() {
    return this._transport.saveDocument();
  }
  getDownloadInfo() {
    return this._transport.downloadInfoCapability.promise;
  }
  cleanup(keepLoadedFonts = false) {
    return this._transport.startCleanup(keepLoadedFonts || this.isPureXfa);
  }
  destroy() {
    return this.loadingTask.destroy();
  }
  cachedPageNumber(ref) {
    return this._transport.cachedPageNumber(ref);
  }
  get loadingParams() {
    return this._transport.loadingParams;
  }
  get loadingTask() {
    return this._transport.loadingTask;
  }
  getFieldObjects() {
    return this._transport.getFieldObjects();
  }
  hasJSActions() {
    return this._transport.hasJSActions();
  }
  getCalculationOrderIds() {
    return this._transport.getCalculationOrderIds();
  }
};
var PDFPageProxy = class {
  #delayedCleanupTimeout = null;
  #pendingCleanup = false;
  constructor(pageIndex, pageInfo, transport, pdfBug = false) {
    this._pageIndex = pageIndex;
    this._pageInfo = pageInfo;
    this._transport = transport;
    this._stats = pdfBug ? new StatTimer() : null;
    this._pdfBug = pdfBug;
    this.commonObjs = transport.commonObjs;
    this.objs = new PDFObjects();
    this._maybeCleanupAfterRender = false;
    this._intentStates = /* @__PURE__ */ new Map();
    this.destroyed = false;
  }
  get pageNumber() {
    return this._pageIndex + 1;
  }
  get rotate() {
    return this._pageInfo.rotate;
  }
  get ref() {
    return this._pageInfo.ref;
  }
  get userUnit() {
    return this._pageInfo.userUnit;
  }
  get view() {
    return this._pageInfo.view;
  }
  getViewport({
    scale,
    rotation = this.rotate,
    offsetX = 0,
    offsetY = 0,
    dontFlip = false
  } = {}) {
    return new PageViewport({
      viewBox: this.view,
      userUnit: this.userUnit,
      scale,
      rotation,
      offsetX,
      offsetY,
      dontFlip
    });
  }
  getAnnotations({
    intent = "display"
  } = {}) {
    const {
      renderingIntent
    } = this._transport.getRenderingIntent(intent);
    return this._transport.getAnnotations(this._pageIndex, renderingIntent);
  }
  getJSActions() {
    return this._transport.getPageJSActions(this._pageIndex);
  }
  get filterFactory() {
    return this._transport.filterFactory;
  }
  get isPureXfa() {
    return shadow(this, "isPureXfa", !!this._transport._htmlForXfa);
  }
  async getXfa() {
    return this._transport._htmlForXfa?.children[this._pageIndex] || null;
  }
  render({
    canvasContext,
    viewport,
    intent = "display",
    annotationMode = AnnotationMode.ENABLE,
    transform = null,
    background = null,
    optionalContentConfigPromise = null,
    annotationCanvasMap = null,
    pageColors = null,
    printAnnotationStorage = null,
    isEditing = false
  }) {
    this._stats?.time("Overall");
    const intentArgs = this._transport.getRenderingIntent(intent, annotationMode, printAnnotationStorage, isEditing);
    const {
      renderingIntent,
      cacheKey
    } = intentArgs;
    this.#pendingCleanup = false;
    this.#abortDelayedCleanup();
    optionalContentConfigPromise ||= this._transport.getOptionalContentConfig(renderingIntent);
    let intentState = this._intentStates.get(cacheKey);
    if (!intentState) {
      intentState = /* @__PURE__ */ Object.create(null);
      this._intentStates.set(cacheKey, intentState);
    }
    if (intentState.streamReaderCancelTimeout) {
      clearTimeout(intentState.streamReaderCancelTimeout);
      intentState.streamReaderCancelTimeout = null;
    }
    const intentPrint = !!(renderingIntent & RenderingIntentFlag.PRINT);
    if (!intentState.displayReadyCapability) {
      intentState.displayReadyCapability = Promise.withResolvers();
      intentState.operatorList = {
        fnArray: [],
        argsArray: [],
        lastChunk: false,
        separateAnnots: null
      };
      this._stats?.time("Page Request");
      this._pumpOperatorList(intentArgs);
    }
    const complete = (error) => {
      intentState.renderTasks.delete(internalRenderTask);
      if (this._maybeCleanupAfterRender || intentPrint) {
        this.#pendingCleanup = true;
      }
      this.#tryCleanup(!intentPrint);
      if (error) {
        internalRenderTask.capability.reject(error);
        this._abortOperatorList({
          intentState,
          reason: error instanceof Error ? error : new Error(error)
        });
      } else {
        internalRenderTask.capability.resolve();
      }
      if (this._stats) {
        this._stats.timeEnd("Rendering");
        this._stats.timeEnd("Overall");
        if (globalThis.Stats?.enabled) {
          globalThis.Stats.add(this.pageNumber, this._stats);
        }
      }
    };
    const internalRenderTask = new InternalRenderTask({
      callback: complete,
      params: {
        canvasContext,
        viewport,
        transform,
        background
      },
      objs: this.objs,
      commonObjs: this.commonObjs,
      annotationCanvasMap,
      operatorList: intentState.operatorList,
      pageIndex: this._pageIndex,
      canvasFactory: this._transport.canvasFactory,
      filterFactory: this._transport.filterFactory,
      useRequestAnimationFrame: !intentPrint,
      pdfBug: this._pdfBug,
      pageColors
    });
    (intentState.renderTasks ||= /* @__PURE__ */ new Set()).add(internalRenderTask);
    const renderTask = internalRenderTask.task;
    Promise.all([intentState.displayReadyCapability.promise, optionalContentConfigPromise]).then(([transparency, optionalContentConfig]) => {
      if (this.destroyed) {
        complete();
        return;
      }
      this._stats?.time("Rendering");
      if (!(optionalContentConfig.renderingIntent & renderingIntent)) {
        throw new Error("Must use the same `intent`-argument when calling the `PDFPageProxy.render` and `PDFDocumentProxy.getOptionalContentConfig` methods.");
      }
      internalRenderTask.initializeGraphics({
        transparency,
        optionalContentConfig
      });
      internalRenderTask.operatorListChanged();
    }).catch(complete);
    return renderTask;
  }
  getOperatorList({
    intent = "display",
    annotationMode = AnnotationMode.ENABLE,
    printAnnotationStorage = null,
    isEditing = false
  } = {}) {
    function operatorListChanged() {
      if (intentState.operatorList.lastChunk) {
        intentState.opListReadCapability.resolve(intentState.operatorList);
        intentState.renderTasks.delete(opListTask);
      }
    }
    const intentArgs = this._transport.getRenderingIntent(intent, annotationMode, printAnnotationStorage, isEditing, true);
    let intentState = this._intentStates.get(intentArgs.cacheKey);
    if (!intentState) {
      intentState = /* @__PURE__ */ Object.create(null);
      this._intentStates.set(intentArgs.cacheKey, intentState);
    }
    let opListTask;
    if (!intentState.opListReadCapability) {
      opListTask = /* @__PURE__ */ Object.create(null);
      opListTask.operatorListChanged = operatorListChanged;
      intentState.opListReadCapability = Promise.withResolvers();
      (intentState.renderTasks ||= /* @__PURE__ */ new Set()).add(opListTask);
      intentState.operatorList = {
        fnArray: [],
        argsArray: [],
        lastChunk: false,
        separateAnnots: null
      };
      this._stats?.time("Page Request");
      this._pumpOperatorList(intentArgs);
    }
    return intentState.opListReadCapability.promise;
  }
  streamTextContent({
    includeMarkedContent = false,
    disableNormalization = false
  } = {}) {
    const TEXT_CONTENT_CHUNK_SIZE = 100;
    return this._transport.messageHandler.sendWithStream("GetTextContent", {
      pageIndex: this._pageIndex,
      includeMarkedContent: includeMarkedContent === true,
      disableNormalization: disableNormalization === true
    }, {
      highWaterMark: TEXT_CONTENT_CHUNK_SIZE,
      size(textContent) {
        return textContent.items.length;
      }
    });
  }
  getTextContent(params = {}) {
    if (this._transport._htmlForXfa) {
      return this.getXfa().then((xfa) => XfaText.textContent(xfa));
    }
    const readableStream = this.streamTextContent(params);
    return new Promise(function(resolve, reject) {
      function pump() {
        reader.read().then(function({
          value,
          done
        }) {
          if (done) {
            resolve(textContent);
            return;
          }
          textContent.lang ??= value.lang;
          Object.assign(textContent.styles, value.styles);
          textContent.items.push(...value.items);
          pump();
        }, reject);
      }
      const reader = readableStream.getReader();
      const textContent = {
        items: [],
        styles: /* @__PURE__ */ Object.create(null),
        lang: null
      };
      pump();
    });
  }
  getStructTree() {
    return this._transport.getStructTree(this._pageIndex);
  }
  _destroy() {
    this.destroyed = true;
    const waitOn = [];
    for (const intentState of this._intentStates.values()) {
      this._abortOperatorList({
        intentState,
        reason: new Error("Page was destroyed."),
        force: true
      });
      if (intentState.opListReadCapability) {
        continue;
      }
      for (const internalRenderTask of intentState.renderTasks) {
        waitOn.push(internalRenderTask.completed);
        internalRenderTask.cancel();
      }
    }
    this.objs.clear();
    this.#pendingCleanup = false;
    this.#abortDelayedCleanup();
    return Promise.all(waitOn);
  }
  cleanup(resetStats = false) {
    this.#pendingCleanup = true;
    const success = this.#tryCleanup(false);
    if (resetStats && success) {
      this._stats &&= new StatTimer();
    }
    return success;
  }
  #tryCleanup(delayed = false) {
    this.#abortDelayedCleanup();
    if (!this.#pendingCleanup || this.destroyed) {
      return false;
    }
    if (delayed) {
      this.#delayedCleanupTimeout = setTimeout(() => {
        this.#delayedCleanupTimeout = null;
        this.#tryCleanup(false);
      }, DELAYED_CLEANUP_TIMEOUT);
      return false;
    }
    for (const {
      renderTasks,
      operatorList
    } of this._intentStates.values()) {
      if (renderTasks.size > 0 || !operatorList.lastChunk) {
        return false;
      }
    }
    this._intentStates.clear();
    this.objs.clear();
    this.#pendingCleanup = false;
    return true;
  }
  #abortDelayedCleanup() {
    if (this.#delayedCleanupTimeout) {
      clearTimeout(this.#delayedCleanupTimeout);
      this.#delayedCleanupTimeout = null;
    }
  }
  _startRenderPage(transparency, cacheKey) {
    const intentState = this._intentStates.get(cacheKey);
    if (!intentState) {
      return;
    }
    this._stats?.timeEnd("Page Request");
    intentState.displayReadyCapability?.resolve(transparency);
  }
  _renderPageChunk(operatorListChunk, intentState) {
    for (let i = 0, ii = operatorListChunk.length; i < ii; i++) {
      intentState.operatorList.fnArray.push(operatorListChunk.fnArray[i]);
      intentState.operatorList.argsArray.push(operatorListChunk.argsArray[i]);
    }
    intentState.operatorList.lastChunk = operatorListChunk.lastChunk;
    intentState.operatorList.separateAnnots = operatorListChunk.separateAnnots;
    for (const internalRenderTask of intentState.renderTasks) {
      internalRenderTask.operatorListChanged();
    }
    if (operatorListChunk.lastChunk) {
      this.#tryCleanup(true);
    }
  }
  _pumpOperatorList({
    renderingIntent,
    cacheKey,
    annotationStorageSerializable,
    modifiedIds
  }) {
    const {
      map,
      transfer
    } = annotationStorageSerializable;
    const readableStream = this._transport.messageHandler.sendWithStream("GetOperatorList", {
      pageIndex: this._pageIndex,
      intent: renderingIntent,
      cacheKey,
      annotationStorage: map,
      modifiedIds
    }, transfer);
    const reader = readableStream.getReader();
    const intentState = this._intentStates.get(cacheKey);
    intentState.streamReader = reader;
    const pump = () => {
      reader.read().then(({
        value,
        done
      }) => {
        if (done) {
          intentState.streamReader = null;
          return;
        }
        if (this._transport.destroyed) {
          return;
        }
        this._renderPageChunk(value, intentState);
        pump();
      }, (reason) => {
        intentState.streamReader = null;
        if (this._transport.destroyed) {
          return;
        }
        if (intentState.operatorList) {
          intentState.operatorList.lastChunk = true;
          for (const internalRenderTask of intentState.renderTasks) {
            internalRenderTask.operatorListChanged();
          }
          this.#tryCleanup(true);
        }
        if (intentState.displayReadyCapability) {
          intentState.displayReadyCapability.reject(reason);
        } else if (intentState.opListReadCapability) {
          intentState.opListReadCapability.reject(reason);
        } else {
          throw reason;
        }
      });
    };
    pump();
  }
  _abortOperatorList({
    intentState,
    reason,
    force = false
  }) {
    if (!intentState.streamReader) {
      return;
    }
    if (intentState.streamReaderCancelTimeout) {
      clearTimeout(intentState.streamReaderCancelTimeout);
      intentState.streamReaderCancelTimeout = null;
    }
    if (!force) {
      if (intentState.renderTasks.size > 0) {
        return;
      }
      if (reason instanceof RenderingCancelledException) {
        let delay = RENDERING_CANCELLED_TIMEOUT;
        if (reason.extraDelay > 0 && reason.extraDelay < 1e3) {
          delay += reason.extraDelay;
        }
        intentState.streamReaderCancelTimeout = setTimeout(() => {
          intentState.streamReaderCancelTimeout = null;
          this._abortOperatorList({
            intentState,
            reason,
            force: true
          });
        }, delay);
        return;
      }
    }
    intentState.streamReader.cancel(new AbortException(reason.message)).catch(() => {
    });
    intentState.streamReader = null;
    if (this._transport.destroyed) {
      return;
    }
    for (const [curCacheKey, curIntentState] of this._intentStates) {
      if (curIntentState === intentState) {
        this._intentStates.delete(curCacheKey);
        break;
      }
    }
    this.cleanup();
  }
  get stats() {
    return this._stats;
  }
};
var LoopbackPort = class {
  #listeners = /* @__PURE__ */ new Map();
  #deferred = Promise.resolve();
  postMessage(obj, transfer) {
    const event = {
      data: structuredClone(obj, transfer ? {
        transfer
      } : null)
    };
    this.#deferred.then(() => {
      for (const [listener] of this.#listeners) {
        listener.call(this, event);
      }
    });
  }
  addEventListener(name, listener, options = null) {
    let rmAbort = null;
    if (options?.signal instanceof AbortSignal) {
      const {
        signal
      } = options;
      if (signal.aborted) {
        warn("LoopbackPort - cannot use an `aborted` signal.");
        return;
      }
      const onAbort = () => this.removeEventListener(name, listener);
      rmAbort = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort);
    }
    this.#listeners.set(listener, rmAbort);
  }
  removeEventListener(name, listener) {
    const rmAbort = this.#listeners.get(listener);
    rmAbort?.();
    this.#listeners.delete(listener);
  }
  terminate() {
    for (const [, rmAbort] of this.#listeners) {
      rmAbort?.();
    }
    this.#listeners.clear();
  }
};
var PDFWorker = class _PDFWorker {
  static #fakeWorkerId = 0;
  static #isWorkerDisabled = false;
  static #workerPorts;
  static {
    if (isNodeJS) {
      this.#isWorkerDisabled = true;
      GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs";
    }
    this._isSameOrigin = (baseUrl, otherUrl) => {
      let base;
      try {
        base = new URL(baseUrl);
        if (!base.origin || base.origin === "null") {
          return false;
        }
      } catch {
        return false;
      }
      const other = new URL(otherUrl, base);
      return base.origin === other.origin;
    };
    this._createCDNWrapper = (url) => {
      const wrapper = `await import("${url}");`;
      return URL.createObjectURL(new Blob([wrapper], {
        type: "text/javascript"
      }));
    };
  }
  constructor({
    name = null,
    port = null,
    verbosity: verbosity2 = getVerbosityLevel()
  } = {}) {
    this.name = name;
    this.destroyed = false;
    this.verbosity = verbosity2;
    this._readyCapability = Promise.withResolvers();
    this._port = null;
    this._webWorker = null;
    this._messageHandler = null;
    if (port) {
      if (_PDFWorker.#workerPorts?.has(port)) {
        throw new Error("Cannot use more than one PDFWorker per port.");
      }
      (_PDFWorker.#workerPorts ||= /* @__PURE__ */ new WeakMap()).set(port, this);
      this._initializeFromPort(port);
      return;
    }
    this._initialize();
  }
  get promise() {
    return this._readyCapability.promise;
  }
  #resolve() {
    this._readyCapability.resolve();
    this._messageHandler.send("configure", {
      verbosity: this.verbosity
    });
  }
  get port() {
    return this._port;
  }
  get messageHandler() {
    return this._messageHandler;
  }
  _initializeFromPort(port) {
    this._port = port;
    this._messageHandler = new MessageHandler("main", "worker", port);
    this._messageHandler.on("ready", function() {
    });
    this.#resolve();
  }
  _initialize() {
    if (_PDFWorker.#isWorkerDisabled || _PDFWorker.#mainThreadWorkerMessageHandler) {
      this._setupFakeWorker();
      return;
    }
    let {
      workerSrc
    } = _PDFWorker;
    try {
      if (!_PDFWorker._isSameOrigin(window.location.href, workerSrc)) {
        workerSrc = _PDFWorker._createCDNWrapper(new URL(workerSrc, window.location).href);
      }
      const worker = new Worker(workerSrc, {
        type: "module"
      });
      const messageHandler = new MessageHandler("main", "worker", worker);
      const terminateEarly = () => {
        ac.abort();
        messageHandler.destroy();
        worker.terminate();
        if (this.destroyed) {
          this._readyCapability.reject(new Error("Worker was destroyed"));
        } else {
          this._setupFakeWorker();
        }
      };
      const ac = new AbortController();
      worker.addEventListener("error", () => {
        if (!this._webWorker) {
          terminateEarly();
        }
      }, {
        signal: ac.signal
      });
      messageHandler.on("test", (data) => {
        ac.abort();
        if (this.destroyed || !data) {
          terminateEarly();
          return;
        }
        this._messageHandler = messageHandler;
        this._port = worker;
        this._webWorker = worker;
        this.#resolve();
      });
      messageHandler.on("ready", (data) => {
        ac.abort();
        if (this.destroyed) {
          terminateEarly();
          return;
        }
        try {
          sendTest();
        } catch {
          this._setupFakeWorker();
        }
      });
      const sendTest = () => {
        const testObj = new Uint8Array();
        messageHandler.send("test", testObj, [testObj.buffer]);
      };
      sendTest();
      return;
    } catch {
      info("The worker has been disabled.");
    }
    this._setupFakeWorker();
  }
  _setupFakeWorker() {
    if (!_PDFWorker.#isWorkerDisabled) {
      warn("Setting up fake worker.");
      _PDFWorker.#isWorkerDisabled = true;
    }
    _PDFWorker._setupFakeWorkerGlobal.then((WorkerMessageHandler) => {
      if (this.destroyed) {
        this._readyCapability.reject(new Error("Worker was destroyed"));
        return;
      }
      const port = new LoopbackPort();
      this._port = port;
      const id = `fake${_PDFWorker.#fakeWorkerId++}`;
      const workerHandler = new MessageHandler(id + "_worker", id, port);
      WorkerMessageHandler.setup(workerHandler, port);
      this._messageHandler = new MessageHandler(id, id + "_worker", port);
      this.#resolve();
    }).catch((reason) => {
      this._readyCapability.reject(new Error(`Setting up fake worker failed: "${reason.message}".`));
    });
  }
  destroy() {
    this.destroyed = true;
    this._webWorker?.terminate();
    this._webWorker = null;
    _PDFWorker.#workerPorts?.delete(this._port);
    this._port = null;
    this._messageHandler?.destroy();
    this._messageHandler = null;
  }
  static fromPort(params) {
    if (!params?.port) {
      throw new Error("PDFWorker.fromPort - invalid method signature.");
    }
    const cachedPort = this.#workerPorts?.get(params.port);
    if (cachedPort) {
      if (cachedPort._pendingDestroy) {
        throw new Error("PDFWorker.fromPort - the worker is being destroyed.\nPlease remember to await `PDFDocumentLoadingTask.destroy()`-calls.");
      }
      return cachedPort;
    }
    return new _PDFWorker(params);
  }
  static get workerSrc() {
    if (GlobalWorkerOptions.workerSrc) {
      return GlobalWorkerOptions.workerSrc;
    }
    throw new Error('No "GlobalWorkerOptions.workerSrc" specified.');
  }
  static get #mainThreadWorkerMessageHandler() {
    try {
      return globalThis.pdfjsWorker?.WorkerMessageHandler || null;
    } catch {
      return null;
    }
  }
  static get _setupFakeWorkerGlobal() {
    const loader = async () => {
      if (this.#mainThreadWorkerMessageHandler) {
        return this.#mainThreadWorkerMessageHandler;
      }
      const worker = await import(
        /*webpackIgnore: true*/
        this.workerSrc
      );
      return worker.WorkerMessageHandler;
    };
    return shadow(this, "_setupFakeWorkerGlobal", loader());
  }
};
var WorkerTransport = class {
  #methodPromises = /* @__PURE__ */ new Map();
  #pageCache = /* @__PURE__ */ new Map();
  #pagePromises = /* @__PURE__ */ new Map();
  #pageRefCache = /* @__PURE__ */ new Map();
  #passwordCapability = null;
  constructor(messageHandler, loadingTask, networkStream, params, factory) {
    this.messageHandler = messageHandler;
    this.loadingTask = loadingTask;
    this.commonObjs = new PDFObjects();
    this.fontLoader = new FontLoader({
      ownerDocument: params.ownerDocument,
      styleElement: params.styleElement
    });
    this.loadingParams = params.loadingParams;
    this._params = params;
    this.canvasFactory = factory.canvasFactory;
    this.filterFactory = factory.filterFactory;
    this.cMapReaderFactory = factory.cMapReaderFactory;
    this.standardFontDataFactory = factory.standardFontDataFactory;
    this.destroyed = false;
    this.destroyCapability = null;
    this._networkStream = networkStream;
    this._fullReader = null;
    this._lastProgress = null;
    this.downloadInfoCapability = Promise.withResolvers();
    this.setupMessageHandler();
  }
  #cacheSimpleMethod(name, data = null) {
    const cachedPromise = this.#methodPromises.get(name);
    if (cachedPromise) {
      return cachedPromise;
    }
    const promise = this.messageHandler.sendWithPromise(name, data);
    this.#methodPromises.set(name, promise);
    return promise;
  }
  get annotationStorage() {
    return shadow(this, "annotationStorage", new AnnotationStorage());
  }
  getRenderingIntent(intent, annotationMode = AnnotationMode.ENABLE, printAnnotationStorage = null, isEditing = false, isOpList = false) {
    let renderingIntent = RenderingIntentFlag.DISPLAY;
    let annotationStorageSerializable = SerializableEmpty;
    switch (intent) {
      case "any":
        renderingIntent = RenderingIntentFlag.ANY;
        break;
      case "display":
        break;
      case "print":
        renderingIntent = RenderingIntentFlag.PRINT;
        break;
      default:
        warn(`getRenderingIntent - invalid intent: ${intent}`);
    }
    const annotationStorage = renderingIntent & RenderingIntentFlag.PRINT && printAnnotationStorage instanceof PrintAnnotationStorage ? printAnnotationStorage : this.annotationStorage;
    switch (annotationMode) {
      case AnnotationMode.DISABLE:
        renderingIntent += RenderingIntentFlag.ANNOTATIONS_DISABLE;
        break;
      case AnnotationMode.ENABLE:
        break;
      case AnnotationMode.ENABLE_FORMS:
        renderingIntent += RenderingIntentFlag.ANNOTATIONS_FORMS;
        break;
      case AnnotationMode.ENABLE_STORAGE:
        renderingIntent += RenderingIntentFlag.ANNOTATIONS_STORAGE;
        annotationStorageSerializable = annotationStorage.serializable;
        break;
      default:
        warn(`getRenderingIntent - invalid annotationMode: ${annotationMode}`);
    }
    if (isEditing) {
      renderingIntent += RenderingIntentFlag.IS_EDITING;
    }
    if (isOpList) {
      renderingIntent += RenderingIntentFlag.OPLIST;
    }
    const {
      ids: modifiedIds,
      hash: modifiedIdsHash
    } = annotationStorage.modifiedIds;
    const cacheKeyBuf = [renderingIntent, annotationStorageSerializable.hash, modifiedIdsHash];
    return {
      renderingIntent,
      cacheKey: cacheKeyBuf.join("_"),
      annotationStorageSerializable,
      modifiedIds
    };
  }
  destroy() {
    if (this.destroyCapability) {
      return this.destroyCapability.promise;
    }
    this.destroyed = true;
    this.destroyCapability = Promise.withResolvers();
    this.#passwordCapability?.reject(new Error("Worker was destroyed during onPassword callback"));
    const waitOn = [];
    for (const page of this.#pageCache.values()) {
      waitOn.push(page._destroy());
    }
    this.#pageCache.clear();
    this.#pagePromises.clear();
    this.#pageRefCache.clear();
    if (this.hasOwnProperty("annotationStorage")) {
      this.annotationStorage.resetModified();
    }
    const terminated = this.messageHandler.sendWithPromise("Terminate", null);
    waitOn.push(terminated);
    Promise.all(waitOn).then(() => {
      this.commonObjs.clear();
      this.fontLoader.clear();
      this.#methodPromises.clear();
      this.filterFactory.destroy();
      TextLayer.cleanup();
      this._networkStream?.cancelAllRequests(new AbortException("Worker was terminated."));
      this.messageHandler?.destroy();
      this.messageHandler = null;
      this.destroyCapability.resolve();
    }, this.destroyCapability.reject);
    return this.destroyCapability.promise;
  }
  setupMessageHandler() {
    const {
      messageHandler,
      loadingTask
    } = this;
    messageHandler.on("GetReader", (data, sink) => {
      assert(this._networkStream, "GetReader - no `IPDFStream` instance available.");
      this._fullReader = this._networkStream.getFullReader();
      this._fullReader.onProgress = (evt) => {
        this._lastProgress = {
          loaded: evt.loaded,
          total: evt.total
        };
      };
      sink.onPull = () => {
        this._fullReader.read().then(function({
          value,
          done
        }) {
          if (done) {
            sink.close();
            return;
          }
          assert(value instanceof ArrayBuffer, "GetReader - expected an ArrayBuffer.");
          sink.enqueue(new Uint8Array(value), 1, [value]);
        }).catch((reason) => {
          sink.error(reason);
        });
      };
      sink.onCancel = (reason) => {
        this._fullReader.cancel(reason);
        sink.ready.catch((readyReason) => {
          if (this.destroyed) {
            return;
          }
          throw readyReason;
        });
      };
    });
    messageHandler.on("ReaderHeadersReady", async (data) => {
      await this._fullReader.headersReady;
      const {
        isStreamingSupported,
        isRangeSupported,
        contentLength
      } = this._fullReader;
      if (!isStreamingSupported || !isRangeSupported) {
        if (this._lastProgress) {
          loadingTask.onProgress?.(this._lastProgress);
        }
        this._fullReader.onProgress = (evt) => {
          loadingTask.onProgress?.({
            loaded: evt.loaded,
            total: evt.total
          });
        };
      }
      return {
        isStreamingSupported,
        isRangeSupported,
        contentLength
      };
    });
    messageHandler.on("GetRangeReader", (data, sink) => {
      assert(this._networkStream, "GetRangeReader - no `IPDFStream` instance available.");
      const rangeReader = this._networkStream.getRangeReader(data.begin, data.end);
      if (!rangeReader) {
        sink.close();
        return;
      }
      sink.onPull = () => {
        rangeReader.read().then(function({
          value,
          done
        }) {
          if (done) {
            sink.close();
            return;
          }
          assert(value instanceof ArrayBuffer, "GetRangeReader - expected an ArrayBuffer.");
          sink.enqueue(new Uint8Array(value), 1, [value]);
        }).catch((reason) => {
          sink.error(reason);
        });
      };
      sink.onCancel = (reason) => {
        rangeReader.cancel(reason);
        sink.ready.catch((readyReason) => {
          if (this.destroyed) {
            return;
          }
          throw readyReason;
        });
      };
    });
    messageHandler.on("GetDoc", ({
      pdfInfo
    }) => {
      this._numPages = pdfInfo.numPages;
      this._htmlForXfa = pdfInfo.htmlForXfa;
      delete pdfInfo.htmlForXfa;
      loadingTask._capability.resolve(new PDFDocumentProxy(pdfInfo, this));
    });
    messageHandler.on("DocException", (ex) => {
      loadingTask._capability.reject(wrapReason(ex));
    });
    messageHandler.on("PasswordRequest", (ex) => {
      this.#passwordCapability = Promise.withResolvers();
      try {
        if (!loadingTask.onPassword) {
          throw wrapReason(ex);
        }
        const updatePassword = (password) => {
          if (password instanceof Error) {
            this.#passwordCapability.reject(password);
          } else {
            this.#passwordCapability.resolve({
              password
            });
          }
        };
        loadingTask.onPassword(updatePassword, ex.code);
      } catch (err) {
        this.#passwordCapability.reject(err);
      }
      return this.#passwordCapability.promise;
    });
    messageHandler.on("DataLoaded", (data) => {
      loadingTask.onProgress?.({
        loaded: data.length,
        total: data.length
      });
      this.downloadInfoCapability.resolve(data);
    });
    messageHandler.on("StartRenderPage", (data) => {
      if (this.destroyed) {
        return;
      }
      const page = this.#pageCache.get(data.pageIndex);
      page._startRenderPage(data.transparency, data.cacheKey);
    });
    messageHandler.on("commonobj", ([id, type, exportedData]) => {
      if (this.destroyed) {
        return null;
      }
      if (this.commonObjs.has(id)) {
        return null;
      }
      switch (type) {
        case "Font":
          const {
            disableFontFace,
            fontExtraProperties,
            pdfBug
          } = this._params;
          if ("error" in exportedData) {
            const exportedError = exportedData.error;
            warn(`Error during font loading: ${exportedError}`);
            this.commonObjs.resolve(id, exportedError);
            break;
          }
          const inspectFont = pdfBug && globalThis.FontInspector?.enabled ? (font2, url) => globalThis.FontInspector.fontAdded(font2, url) : null;
          const font = new FontFaceObject(exportedData, {
            disableFontFace,
            fontExtraProperties,
            inspectFont
          });
          this.fontLoader.bind(font).catch(() => messageHandler.sendWithPromise("FontFallback", {
            id
          })).finally(() => {
            if (!fontExtraProperties && font.data) {
              font.data = null;
            }
            this.commonObjs.resolve(id, font);
          });
          break;
        case "CopyLocalImage":
          const {
            imageRef
          } = exportedData;
          assert(imageRef, "The imageRef must be defined.");
          for (const pageProxy of this.#pageCache.values()) {
            for (const [, data] of pageProxy.objs) {
              if (data?.ref !== imageRef) {
                continue;
              }
              if (!data.dataLen) {
                return null;
              }
              this.commonObjs.resolve(id, structuredClone(data));
              return data.dataLen;
            }
          }
          break;
        case "FontPath":
        case "Image":
        case "Pattern":
          this.commonObjs.resolve(id, exportedData);
          break;
        default:
          throw new Error(`Got unknown common object type ${type}`);
      }
      return null;
    });
    messageHandler.on("obj", ([id, pageIndex, type, imageData]) => {
      if (this.destroyed) {
        return;
      }
      const pageProxy = this.#pageCache.get(pageIndex);
      if (pageProxy.objs.has(id)) {
        return;
      }
      if (pageProxy._intentStates.size === 0) {
        imageData?.bitmap?.close();
        return;
      }
      switch (type) {
        case "Image":
          pageProxy.objs.resolve(id, imageData);
          if (imageData?.dataLen > MAX_IMAGE_SIZE_TO_CACHE) {
            pageProxy._maybeCleanupAfterRender = true;
          }
          break;
        case "Pattern":
          pageProxy.objs.resolve(id, imageData);
          break;
        default:
          throw new Error(`Got unknown object type ${type}`);
      }
    });
    messageHandler.on("DocProgress", (data) => {
      if (this.destroyed) {
        return;
      }
      loadingTask.onProgress?.({
        loaded: data.loaded,
        total: data.total
      });
    });
    messageHandler.on("FetchBuiltInCMap", async (data) => {
      if (this.destroyed) {
        throw new Error("Worker was destroyed.");
      }
      if (!this.cMapReaderFactory) {
        throw new Error("CMapReaderFactory not initialized, see the `useWorkerFetch` parameter.");
      }
      return this.cMapReaderFactory.fetch(data);
    });
    messageHandler.on("FetchStandardFontData", async (data) => {
      if (this.destroyed) {
        throw new Error("Worker was destroyed.");
      }
      if (!this.standardFontDataFactory) {
        throw new Error("StandardFontDataFactory not initialized, see the `useWorkerFetch` parameter.");
      }
      return this.standardFontDataFactory.fetch(data);
    });
  }
  getData() {
    return this.messageHandler.sendWithPromise("GetData", null);
  }
  saveDocument() {
    if (this.annotationStorage.size <= 0) {
      warn("saveDocument called while `annotationStorage` is empty, please use the getData-method instead.");
    }
    const {
      map,
      transfer
    } = this.annotationStorage.serializable;
    return this.messageHandler.sendWithPromise("SaveDocument", {
      isPureXfa: !!this._htmlForXfa,
      numPages: this._numPages,
      annotationStorage: map,
      filename: this._fullReader?.filename ?? null
    }, transfer).finally(() => {
      this.annotationStorage.resetModified();
    });
  }
  getPage(pageNumber) {
    if (!Number.isInteger(pageNumber) || pageNumber <= 0 || pageNumber > this._numPages) {
      return Promise.reject(new Error("Invalid page request."));
    }
    const pageIndex = pageNumber - 1, cachedPromise = this.#pagePromises.get(pageIndex);
    if (cachedPromise) {
      return cachedPromise;
    }
    const promise = this.messageHandler.sendWithPromise("GetPage", {
      pageIndex
    }).then((pageInfo) => {
      if (this.destroyed) {
        throw new Error("Transport destroyed");
      }
      if (pageInfo.refStr) {
        this.#pageRefCache.set(pageInfo.refStr, pageNumber);
      }
      const page = new PDFPageProxy(pageIndex, pageInfo, this, this._params.pdfBug);
      this.#pageCache.set(pageIndex, page);
      return page;
    });
    this.#pagePromises.set(pageIndex, promise);
    return promise;
  }
  getPageIndex(ref) {
    if (!isRefProxy(ref)) {
      return Promise.reject(new Error("Invalid pageIndex request."));
    }
    return this.messageHandler.sendWithPromise("GetPageIndex", {
      num: ref.num,
      gen: ref.gen
    });
  }
  getAnnotations(pageIndex, intent) {
    return this.messageHandler.sendWithPromise("GetAnnotations", {
      pageIndex,
      intent
    });
  }
  getFieldObjects() {
    return this.#cacheSimpleMethod("GetFieldObjects");
  }
  hasJSActions() {
    return this.#cacheSimpleMethod("HasJSActions");
  }
  getCalculationOrderIds() {
    return this.messageHandler.sendWithPromise("GetCalculationOrderIds", null);
  }
  getDestinations() {
    return this.messageHandler.sendWithPromise("GetDestinations", null);
  }
  getDestination(id) {
    if (typeof id !== "string") {
      return Promise.reject(new Error("Invalid destination request."));
    }
    return this.messageHandler.sendWithPromise("GetDestination", {
      id
    });
  }
  getPageLabels() {
    return this.messageHandler.sendWithPromise("GetPageLabels", null);
  }
  getPageLayout() {
    return this.messageHandler.sendWithPromise("GetPageLayout", null);
  }
  getPageMode() {
    return this.messageHandler.sendWithPromise("GetPageMode", null);
  }
  getViewerPreferences() {
    return this.messageHandler.sendWithPromise("GetViewerPreferences", null);
  }
  getOpenAction() {
    return this.messageHandler.sendWithPromise("GetOpenAction", null);
  }
  getAttachments() {
    return this.messageHandler.sendWithPromise("GetAttachments", null);
  }
  getDocJSActions() {
    return this.#cacheSimpleMethod("GetDocJSActions");
  }
  getPageJSActions(pageIndex) {
    return this.messageHandler.sendWithPromise("GetPageJSActions", {
      pageIndex
    });
  }
  getStructTree(pageIndex) {
    return this.messageHandler.sendWithPromise("GetStructTree", {
      pageIndex
    });
  }
  getOutline() {
    return this.messageHandler.sendWithPromise("GetOutline", null);
  }
  getOptionalContentConfig(renderingIntent) {
    return this.#cacheSimpleMethod("GetOptionalContentConfig").then((data) => new OptionalContentConfig(data, renderingIntent));
  }
  getPermissions() {
    return this.messageHandler.sendWithPromise("GetPermissions", null);
  }
  getMetadata() {
    const name = "GetMetadata", cachedPromise = this.#methodPromises.get(name);
    if (cachedPromise) {
      return cachedPromise;
    }
    const promise = this.messageHandler.sendWithPromise(name, null).then((results) => ({
      info: results[0],
      metadata: results[1] ? new Metadata(results[1]) : null,
      contentDispositionFilename: this._fullReader?.filename ?? null,
      contentLength: this._fullReader?.contentLength ?? null
    }));
    this.#methodPromises.set(name, promise);
    return promise;
  }
  getMarkInfo() {
    return this.messageHandler.sendWithPromise("GetMarkInfo", null);
  }
  async startCleanup(keepLoadedFonts = false) {
    if (this.destroyed) {
      return;
    }
    await this.messageHandler.sendWithPromise("Cleanup", null);
    for (const page of this.#pageCache.values()) {
      const cleanupSuccessful = page.cleanup();
      if (!cleanupSuccessful) {
        throw new Error(`startCleanup: Page ${page.pageNumber} is currently rendering.`);
      }
    }
    this.commonObjs.clear();
    if (!keepLoadedFonts) {
      this.fontLoader.clear();
    }
    this.#methodPromises.clear();
    this.filterFactory.destroy(true);
    TextLayer.cleanup();
  }
  cachedPageNumber(ref) {
    if (!isRefProxy(ref)) {
      return null;
    }
    const refStr = ref.gen === 0 ? `${ref.num}R` : `${ref.num}R${ref.gen}`;
    return this.#pageRefCache.get(refStr) ?? null;
  }
};
var INITIAL_DATA = /* @__PURE__ */ Symbol("INITIAL_DATA");
var PDFObjects = class {
  #objs = /* @__PURE__ */ Object.create(null);
  #ensureObj(objId) {
    return this.#objs[objId] ||= {
      ...Promise.withResolvers(),
      data: INITIAL_DATA
    };
  }
  get(objId, callback = null) {
    if (callback) {
      const obj2 = this.#ensureObj(objId);
      obj2.promise.then(() => callback(obj2.data));
      return null;
    }
    const obj = this.#objs[objId];
    if (!obj || obj.data === INITIAL_DATA) {
      throw new Error(`Requesting object that isn't resolved yet ${objId}.`);
    }
    return obj.data;
  }
  has(objId) {
    const obj = this.#objs[objId];
    return !!obj && obj.data !== INITIAL_DATA;
  }
  delete(objId) {
    const obj = this.#objs[objId];
    if (!obj || obj.data === INITIAL_DATA) {
      return false;
    }
    delete this.#objs[objId];
    return true;
  }
  resolve(objId, data = null) {
    const obj = this.#ensureObj(objId);
    obj.data = data;
    obj.resolve();
  }
  clear() {
    for (const objId in this.#objs) {
      const {
        data
      } = this.#objs[objId];
      data?.bitmap?.close();
    }
    this.#objs = /* @__PURE__ */ Object.create(null);
  }
  *[Symbol.iterator]() {
    for (const objId in this.#objs) {
      const {
        data
      } = this.#objs[objId];
      if (data === INITIAL_DATA) {
        continue;
      }
      yield [objId, data];
    }
  }
};
var RenderTask = class {
  #internalRenderTask = null;
  constructor(internalRenderTask) {
    this.#internalRenderTask = internalRenderTask;
    this.onContinue = null;
  }
  get promise() {
    return this.#internalRenderTask.capability.promise;
  }
  cancel(extraDelay = 0) {
    this.#internalRenderTask.cancel(null, extraDelay);
  }
  get separateAnnots() {
    const {
      separateAnnots
    } = this.#internalRenderTask.operatorList;
    if (!separateAnnots) {
      return false;
    }
    const {
      annotationCanvasMap
    } = this.#internalRenderTask;
    return separateAnnots.form || separateAnnots.canvas && annotationCanvasMap?.size > 0;
  }
};
var InternalRenderTask = class _InternalRenderTask {
  #rAF = null;
  static #canvasInUse = /* @__PURE__ */ new WeakSet();
  constructor({
    callback,
    params,
    objs,
    commonObjs,
    annotationCanvasMap,
    operatorList,
    pageIndex,
    canvasFactory,
    filterFactory,
    useRequestAnimationFrame = false,
    pdfBug = false,
    pageColors = null
  }) {
    this.callback = callback;
    this.params = params;
    this.objs = objs;
    this.commonObjs = commonObjs;
    this.annotationCanvasMap = annotationCanvasMap;
    this.operatorListIdx = null;
    this.operatorList = operatorList;
    this._pageIndex = pageIndex;
    this.canvasFactory = canvasFactory;
    this.filterFactory = filterFactory;
    this._pdfBug = pdfBug;
    this.pageColors = pageColors;
    this.running = false;
    this.graphicsReadyCallback = null;
    this.graphicsReady = false;
    this._useRequestAnimationFrame = useRequestAnimationFrame === true && typeof window !== "undefined";
    this.cancelled = false;
    this.capability = Promise.withResolvers();
    this.task = new RenderTask(this);
    this._cancelBound = this.cancel.bind(this);
    this._continueBound = this._continue.bind(this);
    this._scheduleNextBound = this._scheduleNext.bind(this);
    this._nextBound = this._next.bind(this);
    this._canvas = params.canvasContext.canvas;
  }
  get completed() {
    return this.capability.promise.catch(function() {
    });
  }
  initializeGraphics({
    transparency = false,
    optionalContentConfig
  }) {
    if (this.cancelled) {
      return;
    }
    if (this._canvas) {
      if (_InternalRenderTask.#canvasInUse.has(this._canvas)) {
        throw new Error("Cannot use the same canvas during multiple render() operations. Use different canvas or ensure previous operations were cancelled or completed.");
      }
      _InternalRenderTask.#canvasInUse.add(this._canvas);
    }
    if (this._pdfBug && globalThis.StepperManager?.enabled) {
      this.stepper = globalThis.StepperManager.create(this._pageIndex);
      this.stepper.init(this.operatorList);
      this.stepper.nextBreakPoint = this.stepper.getNextBreakPoint();
    }
    const {
      canvasContext,
      viewport,
      transform,
      background
    } = this.params;
    this.gfx = new CanvasGraphics(canvasContext, this.commonObjs, this.objs, this.canvasFactory, this.filterFactory, {
      optionalContentConfig
    }, this.annotationCanvasMap, this.pageColors);
    this.gfx.beginDrawing({
      transform,
      viewport,
      transparency,
      background
    });
    this.operatorListIdx = 0;
    this.graphicsReady = true;
    this.graphicsReadyCallback?.();
  }
  cancel(error = null, extraDelay = 0) {
    this.running = false;
    this.cancelled = true;
    this.gfx?.endDrawing();
    if (this.#rAF) {
      window.cancelAnimationFrame(this.#rAF);
      this.#rAF = null;
    }
    _InternalRenderTask.#canvasInUse.delete(this._canvas);
    this.callback(error || new RenderingCancelledException(`Rendering cancelled, page ${this._pageIndex + 1}`, extraDelay));
  }
  operatorListChanged() {
    if (!this.graphicsReady) {
      this.graphicsReadyCallback ||= this._continueBound;
      return;
    }
    this.stepper?.updateOperatorList(this.operatorList);
    if (this.running) {
      return;
    }
    this._continue();
  }
  _continue() {
    this.running = true;
    if (this.cancelled) {
      return;
    }
    if (this.task.onContinue) {
      this.task.onContinue(this._scheduleNextBound);
    } else {
      this._scheduleNext();
    }
  }
  _scheduleNext() {
    if (this._useRequestAnimationFrame) {
      this.#rAF = window.requestAnimationFrame(() => {
        this.#rAF = null;
        this._nextBound().catch(this._cancelBound);
      });
    } else {
      Promise.resolve().then(this._nextBound).catch(this._cancelBound);
    }
  }
  async _next() {
    if (this.cancelled) {
      return;
    }
    this.operatorListIdx = this.gfx.executeOperatorList(this.operatorList, this.operatorListIdx, this._continueBound, this.stepper);
    if (this.operatorListIdx === this.operatorList.argsArray.length) {
      this.running = false;
      if (this.operatorList.lastChunk) {
        this.gfx.endDrawing();
        _InternalRenderTask.#canvasInUse.delete(this._canvas);
        this.callback();
      }
    }
  }
};
var version = "4.10.38";
var build = "f9bea397f";
var esnext_iterator_flat_map = __webpack_require__(670);
function makeColorComp(n) {
  return Math.floor(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
}
function scaleAndClamp(x) {
  return Math.max(0, Math.min(255, 255 * x));
}
var ColorConverters = class {
  static CMYK_G([c, y, m, k]) {
    return ["G", 1 - Math.min(1, 0.3 * c + 0.59 * m + 0.11 * y + k)];
  }
  static G_CMYK([g]) {
    return ["CMYK", 0, 0, 0, 1 - g];
  }
  static G_RGB([g]) {
    return ["RGB", g, g, g];
  }
  static G_rgb([g]) {
    g = scaleAndClamp(g);
    return [g, g, g];
  }
  static G_HTML([g]) {
    const G = makeColorComp(g);
    return `#${G}${G}${G}`;
  }
  static RGB_G([r, g, b]) {
    return ["G", 0.3 * r + 0.59 * g + 0.11 * b];
  }
  static RGB_rgb(color) {
    return color.map(scaleAndClamp);
  }
  static RGB_HTML(color) {
    return `#${color.map(makeColorComp).join("")}`;
  }
  static T_HTML() {
    return "#00000000";
  }
  static T_rgb() {
    return [null];
  }
  static CMYK_RGB([c, y, m, k]) {
    return ["RGB", 1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)];
  }
  static CMYK_rgb([c, y, m, k]) {
    return [scaleAndClamp(1 - Math.min(1, c + k)), scaleAndClamp(1 - Math.min(1, m + k)), scaleAndClamp(1 - Math.min(1, y + k))];
  }
  static CMYK_HTML(components) {
    const rgb = this.CMYK_RGB(components).slice(1);
    return this.RGB_HTML(rgb);
  }
  static RGB_CMYK([r, g, b]) {
    const c = 1 - r;
    const m = 1 - g;
    const y = 1 - b;
    const k = Math.min(c, m, y);
    return ["CMYK", c, m, y, k];
  }
};
var BaseSVGFactory = class {
  create(width, height, skipDimensions = false) {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid SVG dimensions");
    }
    const svg = this._createSVG("svg:svg");
    svg.setAttribute("version", "1.1");
    if (!skipDimensions) {
      svg.setAttribute("width", `${width}px`);
      svg.setAttribute("height", `${height}px`);
    }
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    return svg;
  }
  createElement(type) {
    if (typeof type !== "string") {
      throw new Error("Invalid SVG element type");
    }
    return this._createSVG(type);
  }
  _createSVG(type) {
    unreachable("Abstract method `_createSVG` called.");
  }
};
var DOMSVGFactory = class extends BaseSVGFactory {
  _createSVG(type) {
    return document.createElementNS(SVG_NS, type);
  }
};
var XfaLayer = class {
  static setupStorage(html, id, element, storage, intent) {
    const storedData = storage.getValue(id, {
      value: null
    });
    switch (element.name) {
      case "textarea":
        if (storedData.value !== null) {
          html.textContent = storedData.value;
        }
        if (intent === "print") {
          break;
        }
        html.addEventListener("input", (event) => {
          storage.setValue(id, {
            value: event.target.value
          });
        });
        break;
      case "input":
        if (element.attributes.type === "radio" || element.attributes.type === "checkbox") {
          if (storedData.value === element.attributes.xfaOn) {
            html.setAttribute("checked", true);
          } else if (storedData.value === element.attributes.xfaOff) {
            html.removeAttribute("checked");
          }
          if (intent === "print") {
            break;
          }
          html.addEventListener("change", (event) => {
            storage.setValue(id, {
              value: event.target.checked ? event.target.getAttribute("xfaOn") : event.target.getAttribute("xfaOff")
            });
          });
        } else {
          if (storedData.value !== null) {
            html.setAttribute("value", storedData.value);
          }
          if (intent === "print") {
            break;
          }
          html.addEventListener("input", (event) => {
            storage.setValue(id, {
              value: event.target.value
            });
          });
        }
        break;
      case "select":
        if (storedData.value !== null) {
          html.setAttribute("value", storedData.value);
          for (const option of element.children) {
            if (option.attributes.value === storedData.value) {
              option.attributes.selected = true;
            } else if (option.attributes.hasOwnProperty("selected")) {
              delete option.attributes.selected;
            }
          }
        }
        html.addEventListener("input", (event) => {
          const options = event.target.options;
          const value = options.selectedIndex === -1 ? "" : options[options.selectedIndex].value;
          storage.setValue(id, {
            value
          });
        });
        break;
    }
  }
  static setAttributes({
    html,
    element,
    storage = null,
    intent,
    linkService
  }) {
    const {
      attributes
    } = element;
    const isHTMLAnchorElement = html instanceof HTMLAnchorElement;
    if (attributes.type === "radio") {
      attributes.name = `${attributes.name}-${intent}`;
    }
    for (const [key, value] of Object.entries(attributes)) {
      if (value === null || value === void 0) {
        continue;
      }
      switch (key) {
        case "class":
          if (value.length) {
            html.setAttribute(key, value.join(" "));
          }
          break;
        case "dataId":
          break;
        case "id":
          html.setAttribute("data-element-id", value);
          break;
        case "style":
          Object.assign(html.style, value);
          break;
        case "textContent":
          html.textContent = value;
          break;
        default:
          if (!isHTMLAnchorElement || key !== "href" && key !== "newWindow") {
            html.setAttribute(key, value);
          }
      }
    }
    if (isHTMLAnchorElement) {
      linkService.addLinkAttributes(html, attributes.href, attributes.newWindow);
    }
    if (storage && attributes.dataId) {
      this.setupStorage(html, attributes.dataId, element, storage);
    }
  }
  static render(parameters) {
    const storage = parameters.annotationStorage;
    const linkService = parameters.linkService;
    const root = parameters.xfaHtml;
    const intent = parameters.intent || "display";
    const rootHtml = document.createElement(root.name);
    if (root.attributes) {
      this.setAttributes({
        html: rootHtml,
        element: root,
        intent,
        linkService
      });
    }
    const isNotForRichText = intent !== "richText";
    const rootDiv = parameters.div;
    rootDiv.append(rootHtml);
    if (parameters.viewport) {
      const transform = `matrix(${parameters.viewport.transform.join(",")})`;
      rootDiv.style.transform = transform;
    }
    if (isNotForRichText) {
      rootDiv.setAttribute("class", "xfaLayer xfaFont");
    }
    const textDivs = [];
    if (root.children.length === 0) {
      if (root.value) {
        const node = document.createTextNode(root.value);
        rootHtml.append(node);
        if (isNotForRichText && XfaText.shouldBuildText(root.name)) {
          textDivs.push(node);
        }
      }
      return {
        textDivs
      };
    }
    const stack = [[root, -1, rootHtml]];
    while (stack.length > 0) {
      const [parent, i, html] = stack.at(-1);
      if (i + 1 === parent.children.length) {
        stack.pop();
        continue;
      }
      const child = parent.children[++stack.at(-1)[1]];
      if (child === null) {
        continue;
      }
      const {
        name
      } = child;
      if (name === "#text") {
        const node = document.createTextNode(child.value);
        textDivs.push(node);
        html.append(node);
        continue;
      }
      const childHtml = child?.attributes?.xmlns ? document.createElementNS(child.attributes.xmlns, name) : document.createElement(name);
      html.append(childHtml);
      if (child.attributes) {
        this.setAttributes({
          html: childHtml,
          element: child,
          storage,
          intent,
          linkService
        });
      }
      if (child.children?.length > 0) {
        stack.push([child, -1, childHtml]);
      } else if (child.value) {
        const node = document.createTextNode(child.value);
        if (isNotForRichText && XfaText.shouldBuildText(name)) {
          textDivs.push(node);
        }
        childHtml.append(node);
      }
    }
    for (const el of rootDiv.querySelectorAll(".xfaNonInteractive input, .xfaNonInteractive textarea")) {
      el.setAttribute("readOnly", true);
    }
    return {
      textDivs
    };
  }
  static update(parameters) {
    const transform = `matrix(${parameters.viewport.transform.join(",")})`;
    parameters.div.style.transform = transform;
    parameters.div.hidden = false;
  }
};
var DEFAULT_TAB_INDEX = 1e3;
var annotation_layer_DEFAULT_FONT_SIZE = 9;
var GetElementsByNameSet = /* @__PURE__ */ new WeakSet();
function getRectDims(rect) {
  return {
    width: rect[2] - rect[0],
    height: rect[3] - rect[1]
  };
}
var AnnotationElementFactory = class {
  static create(parameters) {
    const subtype = parameters.data.annotationType;
    switch (subtype) {
      case AnnotationType.LINK:
        return new LinkAnnotationElement(parameters);
      case AnnotationType.TEXT:
        return new TextAnnotationElement(parameters);
      case AnnotationType.WIDGET:
        const fieldType = parameters.data.fieldType;
        switch (fieldType) {
          case "Tx":
            return new TextWidgetAnnotationElement(parameters);
          case "Btn":
            if (parameters.data.radioButton) {
              return new RadioButtonWidgetAnnotationElement(parameters);
            } else if (parameters.data.checkBox) {
              return new CheckboxWidgetAnnotationElement(parameters);
            }
            return new PushButtonWidgetAnnotationElement(parameters);
          case "Ch":
            return new ChoiceWidgetAnnotationElement(parameters);
          case "Sig":
            return new SignatureWidgetAnnotationElement(parameters);
        }
        return new WidgetAnnotationElement(parameters);
      case AnnotationType.POPUP:
        return new PopupAnnotationElement(parameters);
      case AnnotationType.FREETEXT:
        return new FreeTextAnnotationElement(parameters);
      case AnnotationType.LINE:
        return new LineAnnotationElement(parameters);
      case AnnotationType.SQUARE:
        return new SquareAnnotationElement(parameters);
      case AnnotationType.CIRCLE:
        return new CircleAnnotationElement(parameters);
      case AnnotationType.POLYLINE:
        return new PolylineAnnotationElement(parameters);
      case AnnotationType.CARET:
        return new CaretAnnotationElement(parameters);
      case AnnotationType.INK:
        return new InkAnnotationElement(parameters);
      case AnnotationType.POLYGON:
        return new PolygonAnnotationElement(parameters);
      case AnnotationType.HIGHLIGHT:
        return new HighlightAnnotationElement(parameters);
      case AnnotationType.UNDERLINE:
        return new UnderlineAnnotationElement(parameters);
      case AnnotationType.SQUIGGLY:
        return new SquigglyAnnotationElement(parameters);
      case AnnotationType.STRIKEOUT:
        return new StrikeOutAnnotationElement(parameters);
      case AnnotationType.STAMP:
        return new StampAnnotationElement(parameters);
      case AnnotationType.FILEATTACHMENT:
        return new FileAttachmentAnnotationElement(parameters);
      default:
        return new AnnotationElement(parameters);
    }
  }
};
var AnnotationElement = class _AnnotationElement {
  #updates = null;
  #hasBorder = false;
  #popupElement = null;
  constructor(parameters, {
    isRenderable = false,
    ignoreBorder = false,
    createQuadrilaterals = false
  } = {}) {
    this.isRenderable = isRenderable;
    this.data = parameters.data;
    this.layer = parameters.layer;
    this.linkService = parameters.linkService;
    this.downloadManager = parameters.downloadManager;
    this.imageResourcesPath = parameters.imageResourcesPath;
    this.renderForms = parameters.renderForms;
    this.svgFactory = parameters.svgFactory;
    this.annotationStorage = parameters.annotationStorage;
    this.enableScripting = parameters.enableScripting;
    this.hasJSActions = parameters.hasJSActions;
    this._fieldObjects = parameters.fieldObjects;
    this.parent = parameters.parent;
    if (isRenderable) {
      this.container = this._createContainer(ignoreBorder);
    }
    if (createQuadrilaterals) {
      this._createQuadrilaterals();
    }
  }
  static _hasPopupData({
    titleObj,
    contentsObj,
    richText
  }) {
    return !!(titleObj?.str || contentsObj?.str || richText?.str);
  }
  get _isEditable() {
    return this.data.isEditable;
  }
  get hasPopupData() {
    return _AnnotationElement._hasPopupData(this.data);
  }
  updateEdited(params) {
    if (!this.container) {
      return;
    }
    this.#updates ||= {
      rect: this.data.rect.slice(0)
    };
    const {
      rect
    } = params;
    if (rect) {
      this.#setRectEdited(rect);
    }
    this.#popupElement?.popup.updateEdited(params);
  }
  resetEdited() {
    if (!this.#updates) {
      return;
    }
    this.#setRectEdited(this.#updates.rect);
    this.#popupElement?.popup.resetEdited();
    this.#updates = null;
  }
  #setRectEdited(rect) {
    const {
      container: {
        style
      },
      data: {
        rect: currentRect,
        rotation
      },
      parent: {
        viewport: {
          rawDims: {
            pageWidth,
            pageHeight,
            pageX,
            pageY
          }
        }
      }
    } = this;
    currentRect?.splice(0, 4, ...rect);
    const {
      width,
      height
    } = getRectDims(rect);
    style.left = `${100 * (rect[0] - pageX) / pageWidth}%`;
    style.top = `${100 * (pageHeight - rect[3] + pageY) / pageHeight}%`;
    if (rotation === 0) {
      style.width = `${100 * width / pageWidth}%`;
      style.height = `${100 * height / pageHeight}%`;
    } else {
      this.setRotation(rotation);
    }
  }
  _createContainer(ignoreBorder) {
    const {
      data,
      parent: {
        page,
        viewport
      }
    } = this;
    const container = document.createElement("section");
    container.setAttribute("data-annotation-id", data.id);
    if (!(this instanceof WidgetAnnotationElement)) {
      container.tabIndex = DEFAULT_TAB_INDEX;
    }
    const {
      style
    } = container;
    style.zIndex = this.parent.zIndex++;
    if (data.alternativeText) {
      container.title = data.alternativeText;
    }
    if (data.noRotate) {
      container.classList.add("norotate");
    }
    if (!data.rect || this instanceof PopupAnnotationElement) {
      const {
        rotation: rotation2
      } = data;
      if (!data.hasOwnCanvas && rotation2 !== 0) {
        this.setRotation(rotation2, container);
      }
      return container;
    }
    const {
      width,
      height
    } = getRectDims(data.rect);
    if (!ignoreBorder && data.borderStyle.width > 0) {
      style.borderWidth = `${data.borderStyle.width}px`;
      const horizontalRadius = data.borderStyle.horizontalCornerRadius;
      const verticalRadius = data.borderStyle.verticalCornerRadius;
      if (horizontalRadius > 0 || verticalRadius > 0) {
        const radius = `calc(${horizontalRadius}px * var(--scale-factor)) / calc(${verticalRadius}px * var(--scale-factor))`;
        style.borderRadius = radius;
      } else if (this instanceof RadioButtonWidgetAnnotationElement) {
        const radius = `calc(${width}px * var(--scale-factor)) / calc(${height}px * var(--scale-factor))`;
        style.borderRadius = radius;
      }
      switch (data.borderStyle.style) {
        case AnnotationBorderStyleType.SOLID:
          style.borderStyle = "solid";
          break;
        case AnnotationBorderStyleType.DASHED:
          style.borderStyle = "dashed";
          break;
        case AnnotationBorderStyleType.BEVELED:
          warn("Unimplemented border style: beveled");
          break;
        case AnnotationBorderStyleType.INSET:
          warn("Unimplemented border style: inset");
          break;
        case AnnotationBorderStyleType.UNDERLINE:
          style.borderBottomStyle = "solid";
          break;
        default:
          break;
      }
      const borderColor = data.borderColor || null;
      if (borderColor) {
        this.#hasBorder = true;
        style.borderColor = Util.makeHexColor(borderColor[0] | 0, borderColor[1] | 0, borderColor[2] | 0);
      } else {
        style.borderWidth = 0;
      }
    }
    const rect = Util.normalizeRect([data.rect[0], page.view[3] - data.rect[1] + page.view[1], data.rect[2], page.view[3] - data.rect[3] + page.view[1]]);
    const {
      pageWidth,
      pageHeight,
      pageX,
      pageY
    } = viewport.rawDims;
    style.left = `${100 * (rect[0] - pageX) / pageWidth}%`;
    style.top = `${100 * (rect[1] - pageY) / pageHeight}%`;
    const {
      rotation
    } = data;
    if (data.hasOwnCanvas || rotation === 0) {
      style.width = `${100 * width / pageWidth}%`;
      style.height = `${100 * height / pageHeight}%`;
    } else {
      this.setRotation(rotation, container);
    }
    return container;
  }
  setRotation(angle, container = this.container) {
    if (!this.data.rect) {
      return;
    }
    const {
      pageWidth,
      pageHeight
    } = this.parent.viewport.rawDims;
    const {
      width,
      height
    } = getRectDims(this.data.rect);
    let elementWidth, elementHeight;
    if (angle % 180 === 0) {
      elementWidth = 100 * width / pageWidth;
      elementHeight = 100 * height / pageHeight;
    } else {
      elementWidth = 100 * height / pageWidth;
      elementHeight = 100 * width / pageHeight;
    }
    container.style.width = `${elementWidth}%`;
    container.style.height = `${elementHeight}%`;
    container.setAttribute("data-main-rotation", (360 - angle) % 360);
  }
  get _commonActions() {
    const setColor = (jsName, styleName, event) => {
      const color = event.detail[jsName];
      const colorType = color[0];
      const colorArray = color.slice(1);
      event.target.style[styleName] = ColorConverters[`${colorType}_HTML`](colorArray);
      this.annotationStorage.setValue(this.data.id, {
        [styleName]: ColorConverters[`${colorType}_rgb`](colorArray)
      });
    };
    return shadow(this, "_commonActions", {
      display: (event) => {
        const {
          display
        } = event.detail;
        const hidden = display % 2 === 1;
        this.container.style.visibility = hidden ? "hidden" : "visible";
        this.annotationStorage.setValue(this.data.id, {
          noView: hidden,
          noPrint: display === 1 || display === 2
        });
      },
      print: (event) => {
        this.annotationStorage.setValue(this.data.id, {
          noPrint: !event.detail.print
        });
      },
      hidden: (event) => {
        const {
          hidden
        } = event.detail;
        this.container.style.visibility = hidden ? "hidden" : "visible";
        this.annotationStorage.setValue(this.data.id, {
          noPrint: hidden,
          noView: hidden
        });
      },
      focus: (event) => {
        setTimeout(() => event.target.focus({
          preventScroll: false
        }), 0);
      },
      userName: (event) => {
        event.target.title = event.detail.userName;
      },
      readonly: (event) => {
        event.target.disabled = event.detail.readonly;
      },
      required: (event) => {
        this._setRequired(event.target, event.detail.required);
      },
      bgColor: (event) => {
        setColor("bgColor", "backgroundColor", event);
      },
      fillColor: (event) => {
        setColor("fillColor", "backgroundColor", event);
      },
      fgColor: (event) => {
        setColor("fgColor", "color", event);
      },
      textColor: (event) => {
        setColor("textColor", "color", event);
      },
      borderColor: (event) => {
        setColor("borderColor", "borderColor", event);
      },
      strokeColor: (event) => {
        setColor("strokeColor", "borderColor", event);
      },
      rotation: (event) => {
        const angle = event.detail.rotation;
        this.setRotation(angle);
        this.annotationStorage.setValue(this.data.id, {
          rotation: angle
        });
      }
    });
  }
  _dispatchEventFromSandbox(actions, jsEvent) {
    const commonActions = this._commonActions;
    for (const name of Object.keys(jsEvent.detail)) {
      const action = actions[name] || commonActions[name];
      action?.(jsEvent);
    }
  }
  _setDefaultPropertiesFromJS(element) {
    if (!this.enableScripting) {
      return;
    }
    const storedData = this.annotationStorage.getRawValue(this.data.id);
    if (!storedData) {
      return;
    }
    const commonActions = this._commonActions;
    for (const [actionName, detail] of Object.entries(storedData)) {
      const action = commonActions[actionName];
      if (action) {
        const eventProxy = {
          detail: {
            [actionName]: detail
          },
          target: element
        };
        action(eventProxy);
        delete storedData[actionName];
      }
    }
  }
  _createQuadrilaterals() {
    if (!this.container) {
      return;
    }
    const {
      quadPoints
    } = this.data;
    if (!quadPoints) {
      return;
    }
    const [rectBlX, rectBlY, rectTrX, rectTrY] = this.data.rect.map((x) => Math.fround(x));
    if (quadPoints.length === 8) {
      const [trX, trY, blX, blY] = quadPoints.subarray(2, 6);
      if (rectTrX === trX && rectTrY === trY && rectBlX === blX && rectBlY === blY) {
        return;
      }
    }
    const {
      style
    } = this.container;
    let svgBuffer;
    if (this.#hasBorder) {
      const {
        borderColor,
        borderWidth
      } = style;
      style.borderWidth = 0;
      svgBuffer = ["url('data:image/svg+xml;utf8,", `<svg xmlns="http://www.w3.org/2000/svg"`, ` preserveAspectRatio="none" viewBox="0 0 1 1">`, `<g fill="transparent" stroke="${borderColor}" stroke-width="${borderWidth}">`];
      this.container.classList.add("hasBorder");
    }
    const width = rectTrX - rectBlX;
    const height = rectTrY - rectBlY;
    const {
      svgFactory
    } = this;
    const svg = svgFactory.createElement("svg");
    svg.classList.add("quadrilateralsContainer");
    svg.setAttribute("width", 0);
    svg.setAttribute("height", 0);
    const defs = svgFactory.createElement("defs");
    svg.append(defs);
    const clipPath = svgFactory.createElement("clipPath");
    const id = `clippath_${this.data.id}`;
    clipPath.setAttribute("id", id);
    clipPath.setAttribute("clipPathUnits", "objectBoundingBox");
    defs.append(clipPath);
    for (let i = 2, ii = quadPoints.length; i < ii; i += 8) {
      const trX = quadPoints[i];
      const trY = quadPoints[i + 1];
      const blX = quadPoints[i + 2];
      const blY = quadPoints[i + 3];
      const rect = svgFactory.createElement("rect");
      const x = (blX - rectBlX) / width;
      const y = (rectTrY - trY) / height;
      const rectWidth = (trX - blX) / width;
      const rectHeight = (trY - blY) / height;
      rect.setAttribute("x", x);
      rect.setAttribute("y", y);
      rect.setAttribute("width", rectWidth);
      rect.setAttribute("height", rectHeight);
      clipPath.append(rect);
      svgBuffer?.push(`<rect vector-effect="non-scaling-stroke" x="${x}" y="${y}" width="${rectWidth}" height="${rectHeight}"/>`);
    }
    if (this.#hasBorder) {
      svgBuffer.push(`</g></svg>')`);
      style.backgroundImage = svgBuffer.join("");
    }
    this.container.append(svg);
    this.container.style.clipPath = `url(#${id})`;
  }
  _createPopup() {
    const {
      data
    } = this;
    const popup = this.#popupElement = new PopupAnnotationElement({
      data: {
        color: data.color,
        titleObj: data.titleObj,
        modificationDate: data.modificationDate,
        contentsObj: data.contentsObj,
        richText: data.richText,
        parentRect: data.rect,
        borderStyle: 0,
        id: `popup_${data.id}`,
        rotation: data.rotation
      },
      parent: this.parent,
      elements: [this]
    });
    this.parent.div.append(popup.render());
  }
  render() {
    unreachable("Abstract method `AnnotationElement.render` called");
  }
  _getElementsByName(name, skipId = null) {
    const fields = [];
    if (this._fieldObjects) {
      const fieldObj = this._fieldObjects[name];
      if (fieldObj) {
        for (const {
          page,
          id,
          exportValues
        } of fieldObj) {
          if (page === -1) {
            continue;
          }
          if (id === skipId) {
            continue;
          }
          const exportValue = typeof exportValues === "string" ? exportValues : null;
          const domElement = document.querySelector(`[data-element-id="${id}"]`);
          if (domElement && !GetElementsByNameSet.has(domElement)) {
            warn(`_getElementsByName - element not allowed: ${id}`);
            continue;
          }
          fields.push({
            id,
            exportValue,
            domElement
          });
        }
      }
      return fields;
    }
    for (const domElement of document.getElementsByName(name)) {
      const {
        exportValue
      } = domElement;
      const id = domElement.getAttribute("data-element-id");
      if (id === skipId) {
        continue;
      }
      if (!GetElementsByNameSet.has(domElement)) {
        continue;
      }
      fields.push({
        id,
        exportValue,
        domElement
      });
    }
    return fields;
  }
  show() {
    if (this.container) {
      this.container.hidden = false;
    }
    this.popup?.maybeShow();
  }
  hide() {
    if (this.container) {
      this.container.hidden = true;
    }
    this.popup?.forceHide();
  }
  getElementsToTriggerPopup() {
    return this.container;
  }
  addHighlightArea() {
    const triggers = this.getElementsToTriggerPopup();
    if (Array.isArray(triggers)) {
      for (const element of triggers) {
        element.classList.add("highlightArea");
      }
    } else {
      triggers.classList.add("highlightArea");
    }
  }
  _editOnDoubleClick() {
    if (!this._isEditable) {
      return;
    }
    const {
      annotationEditorType: mode,
      data: {
        id: editId
      }
    } = this;
    this.container.addEventListener("dblclick", () => {
      this.linkService.eventBus?.dispatch("switchannotationeditormode", {
        source: this,
        mode,
        editId
      });
    });
  }
};
var LinkAnnotationElement = class extends AnnotationElement {
  constructor(parameters, options = null) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: !!options?.ignoreBorder,
      createQuadrilaterals: true
    });
    this.isTooltipOnly = parameters.data.isTooltipOnly;
  }
  render() {
    const {
      data,
      linkService
    } = this;
    const link = document.createElement("a");
    link.setAttribute("data-element-id", data.id);
    let isBound = false;
    if (data.url) {
      linkService.addLinkAttributes(link, data.url, data.newWindow);
      isBound = true;
    } else if (data.action) {
      this._bindNamedAction(link, data.action);
      isBound = true;
    } else if (data.attachment) {
      this.#bindAttachment(link, data.attachment, data.attachmentDest);
      isBound = true;
    } else if (data.setOCGState) {
      this.#bindSetOCGState(link, data.setOCGState);
      isBound = true;
    } else if (data.dest) {
      this._bindLink(link, data.dest);
      isBound = true;
    } else {
      if (data.actions && (data.actions.Action || data.actions["Mouse Up"] || data.actions["Mouse Down"]) && this.enableScripting && this.hasJSActions) {
        this._bindJSAction(link, data);
        isBound = true;
      }
      if (data.resetForm) {
        this._bindResetFormAction(link, data.resetForm);
        isBound = true;
      } else if (this.isTooltipOnly && !isBound) {
        this._bindLink(link, "");
        isBound = true;
      }
    }
    this.container.classList.add("linkAnnotation");
    if (isBound) {
      this.container.append(link);
    }
    return this.container;
  }
  #setInternalLink() {
    this.container.setAttribute("data-internal-link", "");
  }
  _bindLink(link, destination) {
    link.href = this.linkService.getDestinationHash(destination);
    link.onclick = () => {
      if (destination) {
        this.linkService.goToDestination(destination);
      }
      return false;
    };
    if (destination || destination === "") {
      this.#setInternalLink();
    }
  }
  _bindNamedAction(link, action) {
    link.href = this.linkService.getAnchorUrl("");
    link.onclick = () => {
      this.linkService.executeNamedAction(action);
      return false;
    };
    this.#setInternalLink();
  }
  #bindAttachment(link, attachment, dest = null) {
    link.href = this.linkService.getAnchorUrl("");
    if (attachment.description) {
      link.title = attachment.description;
    }
    link.onclick = () => {
      this.downloadManager?.openOrDownloadData(attachment.content, attachment.filename, dest);
      return false;
    };
    this.#setInternalLink();
  }
  #bindSetOCGState(link, action) {
    link.href = this.linkService.getAnchorUrl("");
    link.onclick = () => {
      this.linkService.executeSetOCGState(action);
      return false;
    };
    this.#setInternalLink();
  }
  _bindJSAction(link, data) {
    link.href = this.linkService.getAnchorUrl("");
    const map = /* @__PURE__ */ new Map([["Action", "onclick"], ["Mouse Up", "onmouseup"], ["Mouse Down", "onmousedown"]]);
    for (const name of Object.keys(data.actions)) {
      const jsName = map.get(name);
      if (!jsName) {
        continue;
      }
      link[jsName] = () => {
        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id: data.id,
            name
          }
        });
        return false;
      };
    }
    if (!link.onclick) {
      link.onclick = () => false;
    }
    this.#setInternalLink();
  }
  _bindResetFormAction(link, resetForm) {
    const otherClickAction = link.onclick;
    if (!otherClickAction) {
      link.href = this.linkService.getAnchorUrl("");
    }
    this.#setInternalLink();
    if (!this._fieldObjects) {
      warn(`_bindResetFormAction - "resetForm" action not supported, ensure that the \`fieldObjects\` parameter is provided.`);
      if (!otherClickAction) {
        link.onclick = () => false;
      }
      return;
    }
    link.onclick = () => {
      otherClickAction?.();
      const {
        fields: resetFormFields,
        refs: resetFormRefs,
        include
      } = resetForm;
      const allFields = [];
      if (resetFormFields.length !== 0 || resetFormRefs.length !== 0) {
        const fieldIds = new Set(resetFormRefs);
        for (const fieldName of resetFormFields) {
          const fields = this._fieldObjects[fieldName] || [];
          for (const {
            id
          } of fields) {
            fieldIds.add(id);
          }
        }
        for (const fields of Object.values(this._fieldObjects)) {
          for (const field of fields) {
            if (fieldIds.has(field.id) === include) {
              allFields.push(field);
            }
          }
        }
      } else {
        for (const fields of Object.values(this._fieldObjects)) {
          allFields.push(...fields);
        }
      }
      const storage = this.annotationStorage;
      const allIds = [];
      for (const field of allFields) {
        const {
          id
        } = field;
        allIds.push(id);
        switch (field.type) {
          case "text": {
            const value = field.defaultValue || "";
            storage.setValue(id, {
              value
            });
            break;
          }
          case "checkbox":
          case "radiobutton": {
            const value = field.defaultValue === field.exportValues;
            storage.setValue(id, {
              value
            });
            break;
          }
          case "combobox":
          case "listbox": {
            const value = field.defaultValue || "";
            storage.setValue(id, {
              value
            });
            break;
          }
          default:
            continue;
        }
        const domElement = document.querySelector(`[data-element-id="${id}"]`);
        if (!domElement) {
          continue;
        } else if (!GetElementsByNameSet.has(domElement)) {
          warn(`_bindResetFormAction - element not allowed: ${id}`);
          continue;
        }
        domElement.dispatchEvent(new Event("resetform"));
      }
      if (this.enableScripting) {
        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id: "app",
            ids: allIds,
            name: "ResetForm"
          }
        });
      }
      return false;
    };
  }
};
var TextAnnotationElement = class extends AnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: true
    });
  }
  render() {
    this.container.classList.add("textAnnotation");
    const image = document.createElement("img");
    image.src = this.imageResourcesPath + "annotation-" + this.data.name.toLowerCase() + ".svg";
    image.setAttribute("data-l10n-id", "pdfjs-text-annotation-type");
    image.setAttribute("data-l10n-args", JSON.stringify({
      type: this.data.name
    }));
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this.container.append(image);
    return this.container;
  }
};
var WidgetAnnotationElement = class extends AnnotationElement {
  render() {
    return this.container;
  }
  showElementAndHideCanvas(element) {
    if (this.data.hasOwnCanvas) {
      if (element.previousSibling?.nodeName === "CANVAS") {
        element.previousSibling.hidden = true;
      }
      element.hidden = false;
    }
  }
  _getKeyModifier(event) {
    return util_FeatureTest.platform.isMac ? event.metaKey : event.ctrlKey;
  }
  _setEventListener(element, elementData, baseName, eventName, valueGetter) {
    if (baseName.includes("mouse")) {
      element.addEventListener(baseName, (event) => {
        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id: this.data.id,
            name: eventName,
            value: valueGetter(event),
            shift: event.shiftKey,
            modifier: this._getKeyModifier(event)
          }
        });
      });
    } else {
      element.addEventListener(baseName, (event) => {
        if (baseName === "blur") {
          if (!elementData.focused || !event.relatedTarget) {
            return;
          }
          elementData.focused = false;
        } else if (baseName === "focus") {
          if (elementData.focused) {
            return;
          }
          elementData.focused = true;
        }
        if (!valueGetter) {
          return;
        }
        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id: this.data.id,
            name: eventName,
            value: valueGetter(event)
          }
        });
      });
    }
  }
  _setEventListeners(element, elementData, names, getter) {
    for (const [baseName, eventName] of names) {
      if (eventName === "Action" || this.data.actions?.[eventName]) {
        if (eventName === "Focus" || eventName === "Blur") {
          elementData ||= {
            focused: false
          };
        }
        this._setEventListener(element, elementData, baseName, eventName, getter);
        if (eventName === "Focus" && !this.data.actions?.Blur) {
          this._setEventListener(element, elementData, "blur", "Blur", null);
        } else if (eventName === "Blur" && !this.data.actions?.Focus) {
          this._setEventListener(element, elementData, "focus", "Focus", null);
        }
      }
    }
  }
  _setBackgroundColor(element) {
    const color = this.data.backgroundColor || null;
    element.style.backgroundColor = color === null ? "transparent" : Util.makeHexColor(color[0], color[1], color[2]);
  }
  _setTextStyle(element) {
    const TEXT_ALIGNMENT = ["left", "center", "right"];
    const {
      fontColor
    } = this.data.defaultAppearanceData;
    const fontSize = this.data.defaultAppearanceData.fontSize || annotation_layer_DEFAULT_FONT_SIZE;
    const style = element.style;
    let computedFontSize;
    const BORDER_SIZE = 2;
    const roundToOneDecimal = (x) => Math.round(10 * x) / 10;
    if (this.data.multiLine) {
      const height = Math.abs(this.data.rect[3] - this.data.rect[1] - BORDER_SIZE);
      const numberOfLines = Math.round(height / (LINE_FACTOR * fontSize)) || 1;
      const lineHeight = height / numberOfLines;
      computedFontSize = Math.min(fontSize, roundToOneDecimal(lineHeight / LINE_FACTOR));
    } else {
      const height = Math.abs(this.data.rect[3] - this.data.rect[1] - BORDER_SIZE);
      computedFontSize = Math.min(fontSize, roundToOneDecimal(height / LINE_FACTOR));
    }
    style.fontSize = `calc(${computedFontSize}px * var(--scale-factor))`;
    style.color = Util.makeHexColor(fontColor[0], fontColor[1], fontColor[2]);
    if (this.data.textAlignment !== null) {
      style.textAlign = TEXT_ALIGNMENT[this.data.textAlignment];
    }
  }
  _setRequired(element, isRequired) {
    if (isRequired) {
      element.setAttribute("required", true);
    } else {
      element.removeAttribute("required");
    }
    element.setAttribute("aria-required", isRequired);
  }
};
var TextWidgetAnnotationElement = class extends WidgetAnnotationElement {
  constructor(parameters) {
    const isRenderable = parameters.renderForms || parameters.data.hasOwnCanvas || !parameters.data.hasAppearance && !!parameters.data.fieldValue;
    super(parameters, {
      isRenderable
    });
  }
  setPropertyOnSiblings(base, key, value, keyInStorage) {
    const storage = this.annotationStorage;
    for (const element of this._getElementsByName(base.name, base.id)) {
      if (element.domElement) {
        element.domElement[key] = value;
      }
      storage.setValue(element.id, {
        [keyInStorage]: value
      });
    }
  }
  render() {
    const storage = this.annotationStorage;
    const id = this.data.id;
    this.container.classList.add("textWidgetAnnotation");
    let element = null;
    if (this.renderForms) {
      const storedData = storage.getValue(id, {
        value: this.data.fieldValue
      });
      let textContent = storedData.value || "";
      const maxLen = storage.getValue(id, {
        charLimit: this.data.maxLen
      }).charLimit;
      if (maxLen && textContent.length > maxLen) {
        textContent = textContent.slice(0, maxLen);
      }
      let fieldFormattedValues = storedData.formattedValue || this.data.textContent?.join("\n") || null;
      if (fieldFormattedValues && this.data.comb) {
        fieldFormattedValues = fieldFormattedValues.replaceAll(/\s+/g, "");
      }
      const elementData = {
        userValue: textContent,
        formattedValue: fieldFormattedValues,
        lastCommittedValue: null,
        commitKey: 1,
        focused: false
      };
      if (this.data.multiLine) {
        element = document.createElement("textarea");
        element.textContent = fieldFormattedValues ?? textContent;
        if (this.data.doNotScroll) {
          element.style.overflowY = "hidden";
        }
      } else {
        element = document.createElement("input");
        element.type = "text";
        element.setAttribute("value", fieldFormattedValues ?? textContent);
        if (this.data.doNotScroll) {
          element.style.overflowX = "hidden";
        }
      }
      if (this.data.hasOwnCanvas) {
        element.hidden = true;
      }
      GetElementsByNameSet.add(element);
      element.setAttribute("data-element-id", id);
      element.disabled = this.data.readOnly;
      element.name = this.data.fieldName;
      element.tabIndex = DEFAULT_TAB_INDEX;
      this._setRequired(element, this.data.required);
      if (maxLen) {
        element.maxLength = maxLen;
      }
      element.addEventListener("input", (event) => {
        storage.setValue(id, {
          value: event.target.value
        });
        this.setPropertyOnSiblings(element, "value", event.target.value, "value");
        elementData.formattedValue = null;
      });
      element.addEventListener("resetform", (event) => {
        const defaultValue = this.data.defaultFieldValue ?? "";
        element.value = elementData.userValue = defaultValue;
        elementData.formattedValue = null;
      });
      let blurListener = (event) => {
        const {
          formattedValue
        } = elementData;
        if (formattedValue !== null && formattedValue !== void 0) {
          event.target.value = formattedValue;
        }
        event.target.scrollLeft = 0;
      };
      if (this.enableScripting && this.hasJSActions) {
        element.addEventListener("focus", (event) => {
          if (elementData.focused) {
            return;
          }
          const {
            target
          } = event;
          if (elementData.userValue) {
            target.value = elementData.userValue;
          }
          elementData.lastCommittedValue = target.value;
          elementData.commitKey = 1;
          if (!this.data.actions?.Focus) {
            elementData.focused = true;
          }
        });
        element.addEventListener("updatefromsandbox", (jsEvent) => {
          this.showElementAndHideCanvas(jsEvent.target);
          const actions = {
            value(event) {
              elementData.userValue = event.detail.value ?? "";
              storage.setValue(id, {
                value: elementData.userValue.toString()
              });
              event.target.value = elementData.userValue;
            },
            formattedValue(event) {
              const {
                formattedValue
              } = event.detail;
              elementData.formattedValue = formattedValue;
              if (formattedValue !== null && formattedValue !== void 0 && event.target !== document.activeElement) {
                event.target.value = formattedValue;
              }
              storage.setValue(id, {
                formattedValue
              });
            },
            selRange(event) {
              event.target.setSelectionRange(...event.detail.selRange);
            },
            charLimit: (event) => {
              const {
                charLimit
              } = event.detail;
              const {
                target
              } = event;
              if (charLimit === 0) {
                target.removeAttribute("maxLength");
                return;
              }
              target.setAttribute("maxLength", charLimit);
              let value = elementData.userValue;
              if (!value || value.length <= charLimit) {
                return;
              }
              value = value.slice(0, charLimit);
              target.value = elementData.userValue = value;
              storage.setValue(id, {
                value
              });
              this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
                source: this,
                detail: {
                  id,
                  name: "Keystroke",
                  value,
                  willCommit: true,
                  commitKey: 1,
                  selStart: target.selectionStart,
                  selEnd: target.selectionEnd
                }
              });
            }
          };
          this._dispatchEventFromSandbox(actions, jsEvent);
        });
        element.addEventListener("keydown", (event) => {
          elementData.commitKey = 1;
          let commitKey = -1;
          if (event.key === "Escape") {
            commitKey = 0;
          } else if (event.key === "Enter" && !this.data.multiLine) {
            commitKey = 2;
          } else if (event.key === "Tab") {
            elementData.commitKey = 3;
          }
          if (commitKey === -1) {
            return;
          }
          const {
            value
          } = event.target;
          if (elementData.lastCommittedValue === value) {
            return;
          }
          elementData.lastCommittedValue = value;
          elementData.userValue = value;
          this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
            source: this,
            detail: {
              id,
              name: "Keystroke",
              value,
              willCommit: true,
              commitKey,
              selStart: event.target.selectionStart,
              selEnd: event.target.selectionEnd
            }
          });
        });
        const _blurListener = blurListener;
        blurListener = null;
        element.addEventListener("blur", (event) => {
          if (!elementData.focused || !event.relatedTarget) {
            return;
          }
          if (!this.data.actions?.Blur) {
            elementData.focused = false;
          }
          const {
            value
          } = event.target;
          elementData.userValue = value;
          if (elementData.lastCommittedValue !== value) {
            this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
              source: this,
              detail: {
                id,
                name: "Keystroke",
                value,
                willCommit: true,
                commitKey: elementData.commitKey,
                selStart: event.target.selectionStart,
                selEnd: event.target.selectionEnd
              }
            });
          }
          _blurListener(event);
        });
        if (this.data.actions?.Keystroke) {
          element.addEventListener("beforeinput", (event) => {
            elementData.lastCommittedValue = null;
            const {
              data,
              target
            } = event;
            const {
              value,
              selectionStart,
              selectionEnd
            } = target;
            let selStart = selectionStart, selEnd = selectionEnd;
            switch (event.inputType) {
              case "deleteWordBackward": {
                const match = value.substring(0, selectionStart).match(/\w*[^\w]*$/);
                if (match) {
                  selStart -= match[0].length;
                }
                break;
              }
              case "deleteWordForward": {
                const match = value.substring(selectionStart).match(/^[^\w]*\w*/);
                if (match) {
                  selEnd += match[0].length;
                }
                break;
              }
              case "deleteContentBackward":
                if (selectionStart === selectionEnd) {
                  selStart -= 1;
                }
                break;
              case "deleteContentForward":
                if (selectionStart === selectionEnd) {
                  selEnd += 1;
                }
                break;
            }
            event.preventDefault();
            this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
              source: this,
              detail: {
                id,
                name: "Keystroke",
                value,
                change: data || "",
                willCommit: false,
                selStart,
                selEnd
              }
            });
          });
        }
        this._setEventListeners(element, elementData, [["focus", "Focus"], ["blur", "Blur"], ["mousedown", "Mouse Down"], ["mouseenter", "Mouse Enter"], ["mouseleave", "Mouse Exit"], ["mouseup", "Mouse Up"]], (event) => event.target.value);
      }
      if (blurListener) {
        element.addEventListener("blur", blurListener);
      }
      if (this.data.comb) {
        const fieldWidth = this.data.rect[2] - this.data.rect[0];
        const combWidth = fieldWidth / maxLen;
        element.classList.add("comb");
        element.style.letterSpacing = `calc(${combWidth}px * var(--scale-factor) - 1ch)`;
      }
    } else {
      element = document.createElement("div");
      element.textContent = this.data.fieldValue;
      element.style.verticalAlign = "middle";
      element.style.display = "table-cell";
      if (this.data.hasOwnCanvas) {
        element.hidden = true;
      }
    }
    this._setTextStyle(element);
    this._setBackgroundColor(element);
    this._setDefaultPropertiesFromJS(element);
    this.container.append(element);
    return this.container;
  }
};
var SignatureWidgetAnnotationElement = class extends WidgetAnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: !!parameters.data.hasOwnCanvas
    });
  }
};
var CheckboxWidgetAnnotationElement = class extends WidgetAnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: parameters.renderForms
    });
  }
  render() {
    const storage = this.annotationStorage;
    const data = this.data;
    const id = data.id;
    let value = storage.getValue(id, {
      value: data.exportValue === data.fieldValue
    }).value;
    if (typeof value === "string") {
      value = value !== "Off";
      storage.setValue(id, {
        value
      });
    }
    this.container.classList.add("buttonWidgetAnnotation", "checkBox");
    const element = document.createElement("input");
    GetElementsByNameSet.add(element);
    element.setAttribute("data-element-id", id);
    element.disabled = data.readOnly;
    this._setRequired(element, this.data.required);
    element.type = "checkbox";
    element.name = data.fieldName;
    if (value) {
      element.setAttribute("checked", true);
    }
    element.setAttribute("exportValue", data.exportValue);
    element.tabIndex = DEFAULT_TAB_INDEX;
    element.addEventListener("change", (event) => {
      const {
        name,
        checked
      } = event.target;
      for (const checkbox of this._getElementsByName(name, id)) {
        const curChecked = checked && checkbox.exportValue === data.exportValue;
        if (checkbox.domElement) {
          checkbox.domElement.checked = curChecked;
        }
        storage.setValue(checkbox.id, {
          value: curChecked
        });
      }
      storage.setValue(id, {
        value: checked
      });
    });
    element.addEventListener("resetform", (event) => {
      const defaultValue = data.defaultFieldValue || "Off";
      event.target.checked = defaultValue === data.exportValue;
    });
    if (this.enableScripting && this.hasJSActions) {
      element.addEventListener("updatefromsandbox", (jsEvent) => {
        const actions = {
          value(event) {
            event.target.checked = event.detail.value !== "Off";
            storage.setValue(id, {
              value: event.target.checked
            });
          }
        };
        this._dispatchEventFromSandbox(actions, jsEvent);
      });
      this._setEventListeners(element, null, [["change", "Validate"], ["change", "Action"], ["focus", "Focus"], ["blur", "Blur"], ["mousedown", "Mouse Down"], ["mouseenter", "Mouse Enter"], ["mouseleave", "Mouse Exit"], ["mouseup", "Mouse Up"]], (event) => event.target.checked);
    }
    this._setBackgroundColor(element);
    this._setDefaultPropertiesFromJS(element);
    this.container.append(element);
    return this.container;
  }
};
var RadioButtonWidgetAnnotationElement = class extends WidgetAnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: parameters.renderForms
    });
  }
  render() {
    this.container.classList.add("buttonWidgetAnnotation", "radioButton");
    const storage = this.annotationStorage;
    const data = this.data;
    const id = data.id;
    let value = storage.getValue(id, {
      value: data.fieldValue === data.buttonValue
    }).value;
    if (typeof value === "string") {
      value = value !== data.buttonValue;
      storage.setValue(id, {
        value
      });
    }
    if (value) {
      for (const radio of this._getElementsByName(data.fieldName, id)) {
        storage.setValue(radio.id, {
          value: false
        });
      }
    }
    const element = document.createElement("input");
    GetElementsByNameSet.add(element);
    element.setAttribute("data-element-id", id);
    element.disabled = data.readOnly;
    this._setRequired(element, this.data.required);
    element.type = "radio";
    element.name = data.fieldName;
    if (value) {
      element.setAttribute("checked", true);
    }
    element.tabIndex = DEFAULT_TAB_INDEX;
    element.addEventListener("change", (event) => {
      const {
        name,
        checked
      } = event.target;
      for (const radio of this._getElementsByName(name, id)) {
        storage.setValue(radio.id, {
          value: false
        });
      }
      storage.setValue(id, {
        value: checked
      });
    });
    element.addEventListener("resetform", (event) => {
      const defaultValue = data.defaultFieldValue;
      event.target.checked = defaultValue !== null && defaultValue !== void 0 && defaultValue === data.buttonValue;
    });
    if (this.enableScripting && this.hasJSActions) {
      const pdfButtonValue = data.buttonValue;
      element.addEventListener("updatefromsandbox", (jsEvent) => {
        const actions = {
          value: (event) => {
            const checked = pdfButtonValue === event.detail.value;
            for (const radio of this._getElementsByName(event.target.name)) {
              const curChecked = checked && radio.id === id;
              if (radio.domElement) {
                radio.domElement.checked = curChecked;
              }
              storage.setValue(radio.id, {
                value: curChecked
              });
            }
          }
        };
        this._dispatchEventFromSandbox(actions, jsEvent);
      });
      this._setEventListeners(element, null, [["change", "Validate"], ["change", "Action"], ["focus", "Focus"], ["blur", "Blur"], ["mousedown", "Mouse Down"], ["mouseenter", "Mouse Enter"], ["mouseleave", "Mouse Exit"], ["mouseup", "Mouse Up"]], (event) => event.target.checked);
    }
    this._setBackgroundColor(element);
    this._setDefaultPropertiesFromJS(element);
    this.container.append(element);
    return this.container;
  }
};
var PushButtonWidgetAnnotationElement = class extends LinkAnnotationElement {
  constructor(parameters) {
    super(parameters, {
      ignoreBorder: parameters.data.hasAppearance
    });
  }
  render() {
    const container = super.render();
    container.classList.add("buttonWidgetAnnotation", "pushButton");
    const linkElement = container.lastChild;
    if (this.enableScripting && this.hasJSActions && linkElement) {
      this._setDefaultPropertiesFromJS(linkElement);
      linkElement.addEventListener("updatefromsandbox", (jsEvent) => {
        this._dispatchEventFromSandbox({}, jsEvent);
      });
    }
    return container;
  }
};
var ChoiceWidgetAnnotationElement = class extends WidgetAnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: parameters.renderForms
    });
  }
  render() {
    this.container.classList.add("choiceWidgetAnnotation");
    const storage = this.annotationStorage;
    const id = this.data.id;
    const storedData = storage.getValue(id, {
      value: this.data.fieldValue
    });
    const selectElement = document.createElement("select");
    GetElementsByNameSet.add(selectElement);
    selectElement.setAttribute("data-element-id", id);
    selectElement.disabled = this.data.readOnly;
    this._setRequired(selectElement, this.data.required);
    selectElement.name = this.data.fieldName;
    selectElement.tabIndex = DEFAULT_TAB_INDEX;
    let addAnEmptyEntry = this.data.combo && this.data.options.length > 0;
    if (!this.data.combo) {
      selectElement.size = this.data.options.length;
      if (this.data.multiSelect) {
        selectElement.multiple = true;
      }
    }
    selectElement.addEventListener("resetform", (event) => {
      const defaultValue = this.data.defaultFieldValue;
      for (const option of selectElement.options) {
        option.selected = option.value === defaultValue;
      }
    });
    for (const option of this.data.options) {
      const optionElement = document.createElement("option");
      optionElement.textContent = option.displayValue;
      optionElement.value = option.exportValue;
      if (storedData.value.includes(option.exportValue)) {
        optionElement.setAttribute("selected", true);
        addAnEmptyEntry = false;
      }
      selectElement.append(optionElement);
    }
    let removeEmptyEntry = null;
    if (addAnEmptyEntry) {
      const noneOptionElement = document.createElement("option");
      noneOptionElement.value = " ";
      noneOptionElement.setAttribute("hidden", true);
      noneOptionElement.setAttribute("selected", true);
      selectElement.prepend(noneOptionElement);
      removeEmptyEntry = () => {
        noneOptionElement.remove();
        selectElement.removeEventListener("input", removeEmptyEntry);
        removeEmptyEntry = null;
      };
      selectElement.addEventListener("input", removeEmptyEntry);
    }
    const getValue = (isExport) => {
      const name = isExport ? "value" : "textContent";
      const {
        options,
        multiple
      } = selectElement;
      if (!multiple) {
        return options.selectedIndex === -1 ? null : options[options.selectedIndex][name];
      }
      return Array.prototype.filter.call(options, (option) => option.selected).map((option) => option[name]);
    };
    let selectedValues = getValue(false);
    const getItems = (event) => {
      const options = event.target.options;
      return Array.prototype.map.call(options, (option) => ({
        displayValue: option.textContent,
        exportValue: option.value
      }));
    };
    if (this.enableScripting && this.hasJSActions) {
      selectElement.addEventListener("updatefromsandbox", (jsEvent) => {
        const actions = {
          value(event) {
            removeEmptyEntry?.();
            const value = event.detail.value;
            const values = new Set(Array.isArray(value) ? value : [value]);
            for (const option of selectElement.options) {
              option.selected = values.has(option.value);
            }
            storage.setValue(id, {
              value: getValue(true)
            });
            selectedValues = getValue(false);
          },
          multipleSelection(event) {
            selectElement.multiple = true;
          },
          remove(event) {
            const options = selectElement.options;
            const index = event.detail.remove;
            options[index].selected = false;
            selectElement.remove(index);
            if (options.length > 0) {
              const i = Array.prototype.findIndex.call(options, (option) => option.selected);
              if (i === -1) {
                options[0].selected = true;
              }
            }
            storage.setValue(id, {
              value: getValue(true),
              items: getItems(event)
            });
            selectedValues = getValue(false);
          },
          clear(event) {
            while (selectElement.length !== 0) {
              selectElement.remove(0);
            }
            storage.setValue(id, {
              value: null,
              items: []
            });
            selectedValues = getValue(false);
          },
          insert(event) {
            const {
              index,
              displayValue,
              exportValue
            } = event.detail.insert;
            const selectChild = selectElement.children[index];
            const optionElement = document.createElement("option");
            optionElement.textContent = displayValue;
            optionElement.value = exportValue;
            if (selectChild) {
              selectChild.before(optionElement);
            } else {
              selectElement.append(optionElement);
            }
            storage.setValue(id, {
              value: getValue(true),
              items: getItems(event)
            });
            selectedValues = getValue(false);
          },
          items(event) {
            const {
              items
            } = event.detail;
            while (selectElement.length !== 0) {
              selectElement.remove(0);
            }
            for (const item of items) {
              const {
                displayValue,
                exportValue
              } = item;
              const optionElement = document.createElement("option");
              optionElement.textContent = displayValue;
              optionElement.value = exportValue;
              selectElement.append(optionElement);
            }
            if (selectElement.options.length > 0) {
              selectElement.options[0].selected = true;
            }
            storage.setValue(id, {
              value: getValue(true),
              items: getItems(event)
            });
            selectedValues = getValue(false);
          },
          indices(event) {
            const indices = new Set(event.detail.indices);
            for (const option of event.target.options) {
              option.selected = indices.has(option.index);
            }
            storage.setValue(id, {
              value: getValue(true)
            });
            selectedValues = getValue(false);
          },
          editable(event) {
            event.target.disabled = !event.detail.editable;
          }
        };
        this._dispatchEventFromSandbox(actions, jsEvent);
      });
      selectElement.addEventListener("input", (event) => {
        const exportValue = getValue(true);
        const change = getValue(false);
        storage.setValue(id, {
          value: exportValue
        });
        event.preventDefault();
        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id,
            name: "Keystroke",
            value: selectedValues,
            change,
            changeEx: exportValue,
            willCommit: false,
            commitKey: 1,
            keyDown: false
          }
        });
      });
      this._setEventListeners(selectElement, null, [["focus", "Focus"], ["blur", "Blur"], ["mousedown", "Mouse Down"], ["mouseenter", "Mouse Enter"], ["mouseleave", "Mouse Exit"], ["mouseup", "Mouse Up"], ["input", "Action"], ["input", "Validate"]], (event) => event.target.value);
    } else {
      selectElement.addEventListener("input", function(event) {
        storage.setValue(id, {
          value: getValue(true)
        });
      });
    }
    if (this.data.combo) {
      this._setTextStyle(selectElement);
    } else {
    }
    this._setBackgroundColor(selectElement);
    this._setDefaultPropertiesFromJS(selectElement);
    this.container.append(selectElement);
    return this.container;
  }
};
var PopupAnnotationElement = class extends AnnotationElement {
  constructor(parameters) {
    const {
      data,
      elements
    } = parameters;
    super(parameters, {
      isRenderable: AnnotationElement._hasPopupData(data)
    });
    this.elements = elements;
    this.popup = null;
  }
  render() {
    this.container.classList.add("popupAnnotation");
    const popup = this.popup = new PopupElement({
      container: this.container,
      color: this.data.color,
      titleObj: this.data.titleObj,
      modificationDate: this.data.modificationDate,
      contentsObj: this.data.contentsObj,
      richText: this.data.richText,
      rect: this.data.rect,
      parentRect: this.data.parentRect || null,
      parent: this.parent,
      elements: this.elements,
      open: this.data.open
    });
    const elementIds = [];
    for (const element of this.elements) {
      element.popup = popup;
      element.container.ariaHasPopup = "dialog";
      elementIds.push(element.data.id);
      element.addHighlightArea();
    }
    this.container.setAttribute("aria-controls", elementIds.map((id) => `${AnnotationPrefix}${id}`).join(","));
    return this.container;
  }
};
var PopupElement = class {
  #boundKeyDown = this.#keyDown.bind(this);
  #boundHide = this.#hide.bind(this);
  #boundShow = this.#show.bind(this);
  #boundToggle = this.#toggle.bind(this);
  #color = null;
  #container = null;
  #contentsObj = null;
  #dateObj = null;
  #elements = null;
  #parent = null;
  #parentRect = null;
  #pinned = false;
  #popup = null;
  #position = null;
  #rect = null;
  #richText = null;
  #titleObj = null;
  #updates = null;
  #wasVisible = false;
  constructor({
    container,
    color,
    elements,
    titleObj,
    modificationDate,
    contentsObj,
    richText,
    parent,
    rect,
    parentRect,
    open
  }) {
    this.#container = container;
    this.#titleObj = titleObj;
    this.#contentsObj = contentsObj;
    this.#richText = richText;
    this.#parent = parent;
    this.#color = color;
    this.#rect = rect;
    this.#parentRect = parentRect;
    this.#elements = elements;
    this.#dateObj = PDFDateString.toDateObject(modificationDate);
    this.trigger = elements.flatMap((e) => e.getElementsToTriggerPopup());
    for (const element of this.trigger) {
      element.addEventListener("click", this.#boundToggle);
      element.addEventListener("mouseenter", this.#boundShow);
      element.addEventListener("mouseleave", this.#boundHide);
      element.classList.add("popupTriggerArea");
    }
    for (const element of elements) {
      element.container?.addEventListener("keydown", this.#boundKeyDown);
    }
    this.#container.hidden = true;
    if (open) {
      this.#toggle();
    }
  }
  render() {
    if (this.#popup) {
      return;
    }
    const popup = this.#popup = document.createElement("div");
    popup.className = "popup";
    if (this.#color) {
      const baseColor = popup.style.outlineColor = Util.makeHexColor(...this.#color);
      if (CSS.supports("background-color", "color-mix(in srgb, red 30%, white)")) {
        popup.style.backgroundColor = `color-mix(in srgb, ${baseColor} 30%, white)`;
      } else {
        const BACKGROUND_ENLIGHT = 0.7;
        popup.style.backgroundColor = Util.makeHexColor(...this.#color.map((c) => Math.floor(BACKGROUND_ENLIGHT * (255 - c) + c)));
      }
    }
    const header = document.createElement("span");
    header.className = "header";
    const title = document.createElement("h1");
    header.append(title);
    ({
      dir: title.dir,
      str: title.textContent
    } = this.#titleObj);
    popup.append(header);
    if (this.#dateObj) {
      const modificationDate = document.createElement("span");
      modificationDate.classList.add("popupDate");
      modificationDate.setAttribute("data-l10n-id", "pdfjs-annotation-date-time-string");
      modificationDate.setAttribute("data-l10n-args", JSON.stringify({
        dateObj: this.#dateObj.valueOf()
      }));
      header.append(modificationDate);
    }
    const html = this.#html;
    if (html) {
      XfaLayer.render({
        xfaHtml: html,
        intent: "richText",
        div: popup
      });
      popup.lastChild.classList.add("richText", "popupContent");
    } else {
      const contents = this._formatContents(this.#contentsObj);
      popup.append(contents);
    }
    this.#container.append(popup);
  }
  get #html() {
    const richText = this.#richText;
    const contentsObj = this.#contentsObj;
    if (richText?.str && (!contentsObj?.str || contentsObj.str === richText.str)) {
      return this.#richText.html || null;
    }
    return null;
  }
  get #fontSize() {
    return this.#html?.attributes?.style?.fontSize || 0;
  }
  get #fontColor() {
    return this.#html?.attributes?.style?.color || null;
  }
  #makePopupContent(text) {
    const popupLines = [];
    const popupContent = {
      str: text,
      html: {
        name: "div",
        attributes: {
          dir: "auto"
        },
        children: [{
          name: "p",
          children: popupLines
        }]
      }
    };
    const lineAttributes = {
      style: {
        color: this.#fontColor,
        fontSize: this.#fontSize ? `calc(${this.#fontSize}px * var(--scale-factor))` : ""
      }
    };
    for (const line of text.split("\n")) {
      popupLines.push({
        name: "span",
        value: line,
        attributes: lineAttributes
      });
    }
    return popupContent;
  }
  _formatContents({
    str,
    dir
  }) {
    const p = document.createElement("p");
    p.classList.add("popupContent");
    p.dir = dir;
    const lines = str.split(/(?:\r\n?|\n)/);
    for (let i = 0, ii = lines.length; i < ii; ++i) {
      const line = lines[i];
      p.append(document.createTextNode(line));
      if (i < ii - 1) {
        p.append(document.createElement("br"));
      }
    }
    return p;
  }
  #keyDown(event) {
    if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key === "Enter" || event.key === "Escape" && this.#pinned) {
      this.#toggle();
    }
  }
  updateEdited({
    rect,
    popupContent
  }) {
    this.#updates ||= {
      contentsObj: this.#contentsObj,
      richText: this.#richText
    };
    if (rect) {
      this.#position = null;
    }
    if (popupContent) {
      this.#richText = this.#makePopupContent(popupContent);
      this.#contentsObj = null;
    }
    this.#popup?.remove();
    this.#popup = null;
  }
  resetEdited() {
    if (!this.#updates) {
      return;
    }
    ({
      contentsObj: this.#contentsObj,
      richText: this.#richText
    } = this.#updates);
    this.#updates = null;
    this.#popup?.remove();
    this.#popup = null;
    this.#position = null;
  }
  #setPosition() {
    if (this.#position !== null) {
      return;
    }
    const {
      page: {
        view
      },
      viewport: {
        rawDims: {
          pageWidth,
          pageHeight,
          pageX,
          pageY
        }
      }
    } = this.#parent;
    let useParentRect = !!this.#parentRect;
    let rect = useParentRect ? this.#parentRect : this.#rect;
    for (const element of this.#elements) {
      if (!rect || Util.intersect(element.data.rect, rect) !== null) {
        rect = element.data.rect;
        useParentRect = true;
        break;
      }
    }
    const normalizedRect = Util.normalizeRect([rect[0], view[3] - rect[1] + view[1], rect[2], view[3] - rect[3] + view[1]]);
    const HORIZONTAL_SPACE_AFTER_ANNOTATION = 5;
    const parentWidth = useParentRect ? rect[2] - rect[0] + HORIZONTAL_SPACE_AFTER_ANNOTATION : 0;
    const popupLeft = normalizedRect[0] + parentWidth;
    const popupTop = normalizedRect[1];
    this.#position = [100 * (popupLeft - pageX) / pageWidth, 100 * (popupTop - pageY) / pageHeight];
    const {
      style
    } = this.#container;
    style.left = `${this.#position[0]}%`;
    style.top = `${this.#position[1]}%`;
  }
  #toggle() {
    this.#pinned = !this.#pinned;
    if (this.#pinned) {
      this.#show();
      this.#container.addEventListener("click", this.#boundToggle);
      this.#container.addEventListener("keydown", this.#boundKeyDown);
    } else {
      this.#hide();
      this.#container.removeEventListener("click", this.#boundToggle);
      this.#container.removeEventListener("keydown", this.#boundKeyDown);
    }
  }
  #show() {
    if (!this.#popup) {
      this.render();
    }
    if (!this.isVisible) {
      this.#setPosition();
      this.#container.hidden = false;
      this.#container.style.zIndex = parseInt(this.#container.style.zIndex) + 1e3;
    } else if (this.#pinned) {
      this.#container.classList.add("focused");
    }
  }
  #hide() {
    this.#container.classList.remove("focused");
    if (this.#pinned || !this.isVisible) {
      return;
    }
    this.#container.hidden = true;
    this.#container.style.zIndex = parseInt(this.#container.style.zIndex) - 1e3;
  }
  forceHide() {
    this.#wasVisible = this.isVisible;
    if (!this.#wasVisible) {
      return;
    }
    this.#container.hidden = true;
  }
  maybeShow() {
    if (!this.#wasVisible) {
      return;
    }
    if (!this.#popup) {
      this.#show();
    }
    this.#wasVisible = false;
    this.#container.hidden = false;
  }
  get isVisible() {
    return this.#container.hidden === false;
  }
};
var FreeTextAnnotationElement = class extends AnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true
    });
    this.textContent = parameters.data.textContent;
    this.textPosition = parameters.data.textPosition;
    this.annotationEditorType = AnnotationEditorType.FREETEXT;
  }
  render() {
    this.container.classList.add("freeTextAnnotation");
    if (this.textContent) {
      const content = document.createElement("div");
      content.classList.add("annotationTextContent");
      content.setAttribute("role", "comment");
      for (const line of this.textContent) {
        const lineSpan = document.createElement("span");
        lineSpan.textContent = line;
        content.append(lineSpan);
      }
      this.container.append(content);
    }
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this._editOnDoubleClick();
    return this.container;
  }
};
var LineAnnotationElement = class extends AnnotationElement {
  #line = null;
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true
    });
  }
  render() {
    this.container.classList.add("lineAnnotation");
    const data = this.data;
    const {
      width,
      height
    } = getRectDims(data.rect);
    const svg = this.svgFactory.create(width, height, true);
    const line = this.#line = this.svgFactory.createElement("svg:line");
    line.setAttribute("x1", data.rect[2] - data.lineCoordinates[0]);
    line.setAttribute("y1", data.rect[3] - data.lineCoordinates[1]);
    line.setAttribute("x2", data.rect[2] - data.lineCoordinates[2]);
    line.setAttribute("y2", data.rect[3] - data.lineCoordinates[3]);
    line.setAttribute("stroke-width", data.borderStyle.width || 1);
    line.setAttribute("stroke", "transparent");
    line.setAttribute("fill", "transparent");
    svg.append(line);
    this.container.append(svg);
    if (!data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    return this.container;
  }
  getElementsToTriggerPopup() {
    return this.#line;
  }
  addHighlightArea() {
    this.container.classList.add("highlightArea");
  }
};
var SquareAnnotationElement = class extends AnnotationElement {
  #square = null;
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true
    });
  }
  render() {
    this.container.classList.add("squareAnnotation");
    const data = this.data;
    const {
      width,
      height
    } = getRectDims(data.rect);
    const svg = this.svgFactory.create(width, height, true);
    const borderWidth = data.borderStyle.width;
    const square = this.#square = this.svgFactory.createElement("svg:rect");
    square.setAttribute("x", borderWidth / 2);
    square.setAttribute("y", borderWidth / 2);
    square.setAttribute("width", width - borderWidth);
    square.setAttribute("height", height - borderWidth);
    square.setAttribute("stroke-width", borderWidth || 1);
    square.setAttribute("stroke", "transparent");
    square.setAttribute("fill", "transparent");
    svg.append(square);
    this.container.append(svg);
    if (!data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    return this.container;
  }
  getElementsToTriggerPopup() {
    return this.#square;
  }
  addHighlightArea() {
    this.container.classList.add("highlightArea");
  }
};
var CircleAnnotationElement = class extends AnnotationElement {
  #circle = null;
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true
    });
  }
  render() {
    this.container.classList.add("circleAnnotation");
    const data = this.data;
    const {
      width,
      height
    } = getRectDims(data.rect);
    const svg = this.svgFactory.create(width, height, true);
    const borderWidth = data.borderStyle.width;
    const circle = this.#circle = this.svgFactory.createElement("svg:ellipse");
    circle.setAttribute("cx", width / 2);
    circle.setAttribute("cy", height / 2);
    circle.setAttribute("rx", width / 2 - borderWidth / 2);
    circle.setAttribute("ry", height / 2 - borderWidth / 2);
    circle.setAttribute("stroke-width", borderWidth || 1);
    circle.setAttribute("stroke", "transparent");
    circle.setAttribute("fill", "transparent");
    svg.append(circle);
    this.container.append(svg);
    if (!data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    return this.container;
  }
  getElementsToTriggerPopup() {
    return this.#circle;
  }
  addHighlightArea() {
    this.container.classList.add("highlightArea");
  }
};
var PolylineAnnotationElement = class extends AnnotationElement {
  #polyline = null;
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true
    });
    this.containerClassName = "polylineAnnotation";
    this.svgElementName = "svg:polyline";
  }
  render() {
    this.container.classList.add(this.containerClassName);
    const {
      data: {
        rect,
        vertices,
        borderStyle,
        popupRef
      }
    } = this;
    if (!vertices) {
      return this.container;
    }
    const {
      width,
      height
    } = getRectDims(rect);
    const svg = this.svgFactory.create(width, height, true);
    let points = [];
    for (let i = 0, ii = vertices.length; i < ii; i += 2) {
      const x = vertices[i] - rect[0];
      const y = rect[3] - vertices[i + 1];
      points.push(`${x},${y}`);
    }
    points = points.join(" ");
    const polyline = this.#polyline = this.svgFactory.createElement(this.svgElementName);
    polyline.setAttribute("points", points);
    polyline.setAttribute("stroke-width", borderStyle.width || 1);
    polyline.setAttribute("stroke", "transparent");
    polyline.setAttribute("fill", "transparent");
    svg.append(polyline);
    this.container.append(svg);
    if (!popupRef && this.hasPopupData) {
      this._createPopup();
    }
    return this.container;
  }
  getElementsToTriggerPopup() {
    return this.#polyline;
  }
  addHighlightArea() {
    this.container.classList.add("highlightArea");
  }
};
var PolygonAnnotationElement = class extends PolylineAnnotationElement {
  constructor(parameters) {
    super(parameters);
    this.containerClassName = "polygonAnnotation";
    this.svgElementName = "svg:polygon";
  }
};
var CaretAnnotationElement = class extends AnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true
    });
  }
  render() {
    this.container.classList.add("caretAnnotation");
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    return this.container;
  }
};
var InkAnnotationElement = class extends AnnotationElement {
  #polylinesGroupElement = null;
  #polylines = [];
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true
    });
    this.containerClassName = "inkAnnotation";
    this.svgElementName = "svg:polyline";
    this.annotationEditorType = this.data.it === "InkHighlight" ? AnnotationEditorType.HIGHLIGHT : AnnotationEditorType.INK;
  }
  #getTransform(rotation, rect) {
    switch (rotation) {
      case 90:
        return {
          transform: `rotate(90) translate(${-rect[0]},${rect[1]}) scale(1,-1)`,
          width: rect[3] - rect[1],
          height: rect[2] - rect[0]
        };
      case 180:
        return {
          transform: `rotate(180) translate(${-rect[2]},${rect[1]}) scale(1,-1)`,
          width: rect[2] - rect[0],
          height: rect[3] - rect[1]
        };
      case 270:
        return {
          transform: `rotate(270) translate(${-rect[2]},${rect[3]}) scale(1,-1)`,
          width: rect[3] - rect[1],
          height: rect[2] - rect[0]
        };
      default:
        return {
          transform: `translate(${-rect[0]},${rect[3]}) scale(1,-1)`,
          width: rect[2] - rect[0],
          height: rect[3] - rect[1]
        };
    }
  }
  render() {
    this.container.classList.add(this.containerClassName);
    const {
      data: {
        rect,
        rotation,
        inkLists,
        borderStyle,
        popupRef
      }
    } = this;
    const {
      transform,
      width,
      height
    } = this.#getTransform(rotation, rect);
    const svg = this.svgFactory.create(width, height, true);
    const g = this.#polylinesGroupElement = this.svgFactory.createElement("svg:g");
    svg.append(g);
    g.setAttribute("stroke-width", borderStyle.width || 1);
    g.setAttribute("stroke-linecap", "round");
    g.setAttribute("stroke-linejoin", "round");
    g.setAttribute("stroke-miterlimit", 10);
    g.setAttribute("stroke", "transparent");
    g.setAttribute("fill", "transparent");
    g.setAttribute("transform", transform);
    for (let i = 0, ii = inkLists.length; i < ii; i++) {
      const polyline = this.svgFactory.createElement(this.svgElementName);
      this.#polylines.push(polyline);
      polyline.setAttribute("points", inkLists[i].join(","));
      g.append(polyline);
    }
    if (!popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this.container.append(svg);
    this._editOnDoubleClick();
    return this.container;
  }
  updateEdited(params) {
    super.updateEdited(params);
    const {
      thickness,
      points,
      rect
    } = params;
    const g = this.#polylinesGroupElement;
    if (thickness >= 0) {
      g.setAttribute("stroke-width", thickness || 1);
    }
    if (points) {
      for (let i = 0, ii = this.#polylines.length; i < ii; i++) {
        this.#polylines[i].setAttribute("points", points[i].join(","));
      }
    }
    if (rect) {
      const {
        transform,
        width,
        height
      } = this.#getTransform(this.data.rotation, rect);
      const root = g.parentElement;
      root.setAttribute("viewBox", `0 0 ${width} ${height}`);
      g.setAttribute("transform", transform);
    }
  }
  getElementsToTriggerPopup() {
    return this.#polylines;
  }
  addHighlightArea() {
    this.container.classList.add("highlightArea");
  }
};
var HighlightAnnotationElement = class extends AnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true,
      createQuadrilaterals: true
    });
    this.annotationEditorType = AnnotationEditorType.HIGHLIGHT;
  }
  render() {
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this.container.classList.add("highlightAnnotation");
    this._editOnDoubleClick();
    return this.container;
  }
};
var UnderlineAnnotationElement = class extends AnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true,
      createQuadrilaterals: true
    });
  }
  render() {
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this.container.classList.add("underlineAnnotation");
    return this.container;
  }
};
var SquigglyAnnotationElement = class extends AnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true,
      createQuadrilaterals: true
    });
  }
  render() {
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this.container.classList.add("squigglyAnnotation");
    return this.container;
  }
};
var StrikeOutAnnotationElement = class extends AnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true,
      createQuadrilaterals: true
    });
  }
  render() {
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this.container.classList.add("strikeoutAnnotation");
    return this.container;
  }
};
var StampAnnotationElement = class extends AnnotationElement {
  constructor(parameters) {
    super(parameters, {
      isRenderable: true,
      ignoreBorder: true
    });
    this.annotationEditorType = AnnotationEditorType.STAMP;
  }
  render() {
    this.container.classList.add("stampAnnotation");
    this.container.setAttribute("role", "img");
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this._editOnDoubleClick();
    return this.container;
  }
};
var FileAttachmentAnnotationElement = class extends AnnotationElement {
  #trigger = null;
  constructor(parameters) {
    super(parameters, {
      isRenderable: true
    });
    const {
      file
    } = this.data;
    this.filename = file.filename;
    this.content = file.content;
    this.linkService.eventBus?.dispatch("fileattachmentannotation", {
      source: this,
      ...file
    });
  }
  render() {
    this.container.classList.add("fileAttachmentAnnotation");
    const {
      container,
      data
    } = this;
    let trigger;
    if (data.hasAppearance || data.fillAlpha === 0) {
      trigger = document.createElement("div");
    } else {
      trigger = document.createElement("img");
      trigger.src = `${this.imageResourcesPath}annotation-${/paperclip/i.test(data.name) ? "paperclip" : "pushpin"}.svg`;
      if (data.fillAlpha && data.fillAlpha < 1) {
        trigger.style = `filter: opacity(${Math.round(data.fillAlpha * 100)}%);`;
      }
    }
    trigger.addEventListener("dblclick", this.#download.bind(this));
    this.#trigger = trigger;
    const {
      isMac
    } = util_FeatureTest.platform;
    container.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && (isMac ? evt.metaKey : evt.ctrlKey)) {
        this.#download();
      }
    });
    if (!data.popupRef && this.hasPopupData) {
      this._createPopup();
    } else {
      trigger.classList.add("popupTriggerArea");
    }
    container.append(trigger);
    return container;
  }
  getElementsToTriggerPopup() {
    return this.#trigger;
  }
  addHighlightArea() {
    this.container.classList.add("highlightArea");
  }
  #download() {
    this.downloadManager?.openOrDownloadData(this.content, this.filename);
  }
};
var AnnotationLayer = class {
  #accessibilityManager = null;
  #annotationCanvasMap = null;
  #editableAnnotations = /* @__PURE__ */ new Map();
  #structTreeLayer = null;
  constructor({
    div,
    accessibilityManager,
    annotationCanvasMap,
    annotationEditorUIManager,
    page,
    viewport,
    structTreeLayer
  }) {
    this.div = div;
    this.#accessibilityManager = accessibilityManager;
    this.#annotationCanvasMap = annotationCanvasMap;
    this.#structTreeLayer = structTreeLayer || null;
    this.page = page;
    this.viewport = viewport;
    this.zIndex = 0;
    this._annotationEditorUIManager = annotationEditorUIManager;
  }
  hasEditableAnnotations() {
    return this.#editableAnnotations.size > 0;
  }
  async #appendElement(element, id) {
    const contentElement = element.firstChild || element;
    const annotationId = contentElement.id = `${AnnotationPrefix}${id}`;
    const ariaAttributes = await this.#structTreeLayer?.getAriaAttributes(annotationId);
    if (ariaAttributes) {
      for (const [key, value] of ariaAttributes) {
        contentElement.setAttribute(key, value);
      }
    }
    this.div.append(element);
    this.#accessibilityManager?.moveElementInDOM(this.div, element, contentElement, false);
  }
  async render(params) {
    const {
      annotations
    } = params;
    const layer = this.div;
    setLayerDimensions(layer, this.viewport);
    const popupToElements = /* @__PURE__ */ new Map();
    const elementParams = {
      data: null,
      layer,
      linkService: params.linkService,
      downloadManager: params.downloadManager,
      imageResourcesPath: params.imageResourcesPath || "",
      renderForms: params.renderForms !== false,
      svgFactory: new DOMSVGFactory(),
      annotationStorage: params.annotationStorage || new AnnotationStorage(),
      enableScripting: params.enableScripting === true,
      hasJSActions: params.hasJSActions,
      fieldObjects: params.fieldObjects,
      parent: this,
      elements: null
    };
    for (const data of annotations) {
      if (data.noHTML) {
        continue;
      }
      const isPopupAnnotation = data.annotationType === AnnotationType.POPUP;
      if (!isPopupAnnotation) {
        const {
          width,
          height
        } = getRectDims(data.rect);
        if (width <= 0 || height <= 0) {
          continue;
        }
      } else {
        const elements = popupToElements.get(data.id);
        if (!elements) {
          continue;
        }
        elementParams.elements = elements;
      }
      elementParams.data = data;
      const element = AnnotationElementFactory.create(elementParams);
      if (!element.isRenderable) {
        continue;
      }
      if (!isPopupAnnotation && data.popupRef) {
        const elements = popupToElements.get(data.popupRef);
        if (!elements) {
          popupToElements.set(data.popupRef, [element]);
        } else {
          elements.push(element);
        }
      }
      const rendered = element.render();
      if (data.hidden) {
        rendered.style.visibility = "hidden";
      }
      await this.#appendElement(rendered, data.id);
      if (element._isEditable) {
        this.#editableAnnotations.set(element.data.id, element);
        this._annotationEditorUIManager?.renderAnnotationElement(element);
      }
    }
    this.#setAnnotationCanvasMap();
  }
  update({
    viewport
  }) {
    const layer = this.div;
    this.viewport = viewport;
    setLayerDimensions(layer, {
      rotation: viewport.rotation
    });
    this.#setAnnotationCanvasMap();
    layer.hidden = false;
  }
  #setAnnotationCanvasMap() {
    if (!this.#annotationCanvasMap) {
      return;
    }
    const layer = this.div;
    for (const [id, canvas] of this.#annotationCanvasMap) {
      const element = layer.querySelector(`[data-annotation-id="${id}"]`);
      if (!element) {
        continue;
      }
      canvas.className = "annotationContent";
      const {
        firstChild
      } = element;
      if (!firstChild) {
        element.append(canvas);
      } else if (firstChild.nodeName === "CANVAS") {
        firstChild.replaceWith(canvas);
      } else if (!firstChild.classList.contains("annotationContent")) {
        firstChild.before(canvas);
      } else {
        firstChild.after(canvas);
      }
    }
    this.#annotationCanvasMap.clear();
  }
  getEditableAnnotations() {
    return Array.from(this.#editableAnnotations.values());
  }
  getEditableAnnotation(id) {
    return this.#editableAnnotations.get(id);
  }
};
var EOL_PATTERN = /\r\n?|\n/g;
var FreeTextEditor = class _FreeTextEditor extends AnnotationEditor {
  #color;
  #content = "";
  #editorDivId = `${this.id}-editor`;
  #editModeAC = null;
  #fontSize;
  static _freeTextDefaultContent = "";
  static _internalPadding = 0;
  static _defaultColor = null;
  static _defaultFontSize = 10;
  static get _keyboardManager() {
    const proto = _FreeTextEditor.prototype;
    const arrowChecker = (self2) => self2.isEmpty();
    const small = AnnotationEditorUIManager.TRANSLATE_SMALL;
    const big = AnnotationEditorUIManager.TRANSLATE_BIG;
    return shadow(this, "_keyboardManager", new KeyboardManager([[["ctrl+s", "mac+meta+s", "ctrl+p", "mac+meta+p"], proto.commitOrRemove, {
      bubbles: true
    }], [["ctrl+Enter", "mac+meta+Enter", "Escape", "mac+Escape"], proto.commitOrRemove], [["ArrowLeft", "mac+ArrowLeft"], proto._translateEmpty, {
      args: [-small, 0],
      checker: arrowChecker
    }], [["ctrl+ArrowLeft", "mac+shift+ArrowLeft"], proto._translateEmpty, {
      args: [-big, 0],
      checker: arrowChecker
    }], [["ArrowRight", "mac+ArrowRight"], proto._translateEmpty, {
      args: [small, 0],
      checker: arrowChecker
    }], [["ctrl+ArrowRight", "mac+shift+ArrowRight"], proto._translateEmpty, {
      args: [big, 0],
      checker: arrowChecker
    }], [["ArrowUp", "mac+ArrowUp"], proto._translateEmpty, {
      args: [0, -small],
      checker: arrowChecker
    }], [["ctrl+ArrowUp", "mac+shift+ArrowUp"], proto._translateEmpty, {
      args: [0, -big],
      checker: arrowChecker
    }], [["ArrowDown", "mac+ArrowDown"], proto._translateEmpty, {
      args: [0, small],
      checker: arrowChecker
    }], [["ctrl+ArrowDown", "mac+shift+ArrowDown"], proto._translateEmpty, {
      args: [0, big],
      checker: arrowChecker
    }]]));
  }
  static _type = "freetext";
  static _editorType = AnnotationEditorType.FREETEXT;
  constructor(params) {
    super({
      ...params,
      name: "freeTextEditor"
    });
    this.#color = params.color || _FreeTextEditor._defaultColor || AnnotationEditor._defaultLineColor;
    this.#fontSize = params.fontSize || _FreeTextEditor._defaultFontSize;
  }
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
    const style = getComputedStyle(document.documentElement);
    this._internalPadding = parseFloat(style.getPropertyValue("--freetext-padding"));
  }
  static updateDefaultParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.FREETEXT_SIZE:
        _FreeTextEditor._defaultFontSize = value;
        break;
      case AnnotationEditorParamsType.FREETEXT_COLOR:
        _FreeTextEditor._defaultColor = value;
        break;
    }
  }
  updateParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.FREETEXT_SIZE:
        this.#updateFontSize(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_COLOR:
        this.#updateColor(value);
        break;
    }
  }
  static get defaultPropertiesToUpdate() {
    return [[AnnotationEditorParamsType.FREETEXT_SIZE, _FreeTextEditor._defaultFontSize], [AnnotationEditorParamsType.FREETEXT_COLOR, _FreeTextEditor._defaultColor || AnnotationEditor._defaultLineColor]];
  }
  get propertiesToUpdate() {
    return [[AnnotationEditorParamsType.FREETEXT_SIZE, this.#fontSize], [AnnotationEditorParamsType.FREETEXT_COLOR, this.#color]];
  }
  #updateFontSize(fontSize) {
    const setFontsize = (size) => {
      this.editorDiv.style.fontSize = `calc(${size}px * var(--scale-factor))`;
      this.translate(0, -(size - this.#fontSize) * this.parentScale);
      this.#fontSize = size;
      this.#setEditorDimensions();
    };
    const savedFontsize = this.#fontSize;
    this.addCommands({
      cmd: setFontsize.bind(this, fontSize),
      undo: setFontsize.bind(this, savedFontsize),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_SIZE,
      overwriteIfSameType: true,
      keepUndo: true
    });
  }
  #updateColor(color) {
    const setColor = (col) => {
      this.#color = this.editorDiv.style.color = col;
    };
    const savedColor = this.#color;
    this.addCommands({
      cmd: setColor.bind(this, color),
      undo: setColor.bind(this, savedColor),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_COLOR,
      overwriteIfSameType: true,
      keepUndo: true
    });
  }
  _translateEmpty(x, y) {
    this._uiManager.translateSelectedEditors(x, y, true);
  }
  getInitialTranslation() {
    const scale = this.parentScale;
    return [-_FreeTextEditor._internalPadding * scale, -(_FreeTextEditor._internalPadding + this.#fontSize) * scale];
  }
  rebuild() {
    if (!this.parent) {
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }
    if (!this.isAttachedToDOM) {
      this.parent.add(this);
    }
  }
  enableEditMode() {
    if (this.isInEditMode()) {
      return;
    }
    this.parent.setEditingState(false);
    this.parent.updateToolbar(AnnotationEditorType.FREETEXT);
    super.enableEditMode();
    this.overlayDiv.classList.remove("enabled");
    this.editorDiv.contentEditable = true;
    this._isDraggable = false;
    this.div.removeAttribute("aria-activedescendant");
    this.#editModeAC = new AbortController();
    const signal = this._uiManager.combinedSignal(this.#editModeAC);
    this.editorDiv.addEventListener("keydown", this.editorDivKeydown.bind(this), {
      signal
    });
    this.editorDiv.addEventListener("focus", this.editorDivFocus.bind(this), {
      signal
    });
    this.editorDiv.addEventListener("blur", this.editorDivBlur.bind(this), {
      signal
    });
    this.editorDiv.addEventListener("input", this.editorDivInput.bind(this), {
      signal
    });
    this.editorDiv.addEventListener("paste", this.editorDivPaste.bind(this), {
      signal
    });
  }
  disableEditMode() {
    if (!this.isInEditMode()) {
      return;
    }
    this.parent.setEditingState(true);
    super.disableEditMode();
    this.overlayDiv.classList.add("enabled");
    this.editorDiv.contentEditable = false;
    this.div.setAttribute("aria-activedescendant", this.#editorDivId);
    this._isDraggable = true;
    this.#editModeAC?.abort();
    this.#editModeAC = null;
    this.div.focus({
      preventScroll: true
    });
    this.isEditing = false;
    this.parent.div.classList.add("freetextEditing");
  }
  focusin(event) {
    if (!this._focusEventsAllowed) {
      return;
    }
    super.focusin(event);
    if (event.target !== this.editorDiv) {
      this.editorDiv.focus();
    }
  }
  onceAdded(focus) {
    if (this.width) {
      return;
    }
    this.enableEditMode();
    if (focus) {
      this.editorDiv.focus();
    }
    if (this._initialOptions?.isCentered) {
      this.center();
    }
    this._initialOptions = null;
  }
  isEmpty() {
    return !this.editorDiv || this.editorDiv.innerText.trim() === "";
  }
  remove() {
    this.isEditing = false;
    if (this.parent) {
      this.parent.setEditingState(true);
      this.parent.div.classList.add("freetextEditing");
    }
    super.remove();
  }
  #extractText() {
    const buffer = [];
    this.editorDiv.normalize();
    let prevChild = null;
    for (const child of this.editorDiv.childNodes) {
      if (prevChild?.nodeType === Node.TEXT_NODE && child.nodeName === "BR") {
        continue;
      }
      buffer.push(_FreeTextEditor.#getNodeContent(child));
      prevChild = child;
    }
    return buffer.join("\n");
  }
  #setEditorDimensions() {
    const [parentWidth, parentHeight] = this.parentDimensions;
    let rect;
    if (this.isAttachedToDOM) {
      rect = this.div.getBoundingClientRect();
    } else {
      const {
        currentLayer,
        div
      } = this;
      const savedDisplay = div.style.display;
      const savedVisibility = div.classList.contains("hidden");
      div.classList.remove("hidden");
      div.style.display = "hidden";
      currentLayer.div.append(this.div);
      rect = div.getBoundingClientRect();
      div.remove();
      div.style.display = savedDisplay;
      div.classList.toggle("hidden", savedVisibility);
    }
    if (this.rotation % 180 === this.parentRotation % 180) {
      this.width = rect.width / parentWidth;
      this.height = rect.height / parentHeight;
    } else {
      this.width = rect.height / parentWidth;
      this.height = rect.width / parentHeight;
    }
    this.fixAndSetPosition();
  }
  commit() {
    if (!this.isInEditMode()) {
      return;
    }
    super.commit();
    this.disableEditMode();
    const savedText = this.#content;
    const newText = this.#content = this.#extractText().trimEnd();
    if (savedText === newText) {
      return;
    }
    const setText = (text) => {
      this.#content = text;
      if (!text) {
        this.remove();
        return;
      }
      this.#setContent();
      this._uiManager.rebuild(this);
      this.#setEditorDimensions();
    };
    this.addCommands({
      cmd: () => {
        setText(newText);
      },
      undo: () => {
        setText(savedText);
      },
      mustExec: false
    });
    this.#setEditorDimensions();
  }
  shouldGetKeyboardEvents() {
    return this.isInEditMode();
  }
  enterInEditMode() {
    this.enableEditMode();
    this.editorDiv.focus();
  }
  dblclick(event) {
    this.enterInEditMode();
  }
  keydown(event) {
    if (event.target === this.div && event.key === "Enter") {
      this.enterInEditMode();
      event.preventDefault();
    }
  }
  editorDivKeydown(event) {
    _FreeTextEditor._keyboardManager.exec(this, event);
  }
  editorDivFocus(event) {
    this.isEditing = true;
  }
  editorDivBlur(event) {
    this.isEditing = false;
  }
  editorDivInput(event) {
    this.parent.div.classList.toggle("freetextEditing", this.isEmpty());
  }
  disableEditing() {
    this.editorDiv.setAttribute("role", "comment");
    this.editorDiv.removeAttribute("aria-multiline");
  }
  enableEditing() {
    this.editorDiv.setAttribute("role", "textbox");
    this.editorDiv.setAttribute("aria-multiline", true);
  }
  render() {
    if (this.div) {
      return this.div;
    }
    let baseX, baseY;
    if (this.width) {
      baseX = this.x;
      baseY = this.y;
    }
    super.render();
    this.editorDiv = document.createElement("div");
    this.editorDiv.className = "internal";
    this.editorDiv.setAttribute("id", this.#editorDivId);
    this.editorDiv.setAttribute("data-l10n-id", "pdfjs-free-text2");
    this.editorDiv.setAttribute("data-l10n-attrs", "default-content");
    this.enableEditing();
    this.editorDiv.contentEditable = true;
    const {
      style
    } = this.editorDiv;
    style.fontSize = `calc(${this.#fontSize}px * var(--scale-factor))`;
    style.color = this.#color;
    this.div.append(this.editorDiv);
    this.overlayDiv = document.createElement("div");
    this.overlayDiv.classList.add("overlay", "enabled");
    this.div.append(this.overlayDiv);
    bindEvents(this, this.div, ["dblclick", "keydown"]);
    if (this.width) {
      const [parentWidth, parentHeight] = this.parentDimensions;
      if (this.annotationElementId) {
        const {
          position
        } = this._initialData;
        let [tx, ty] = this.getInitialTranslation();
        [tx, ty] = this.pageTranslationToScreen(tx, ty);
        const [pageWidth, pageHeight] = this.pageDimensions;
        const [pageX, pageY] = this.pageTranslation;
        let posX, posY;
        switch (this.rotation) {
          case 0:
            posX = baseX + (position[0] - pageX) / pageWidth;
            posY = baseY + this.height - (position[1] - pageY) / pageHeight;
            break;
          case 90:
            posX = baseX + (position[0] - pageX) / pageWidth;
            posY = baseY - (position[1] - pageY) / pageHeight;
            [tx, ty] = [ty, -tx];
            break;
          case 180:
            posX = baseX - this.width + (position[0] - pageX) / pageWidth;
            posY = baseY - (position[1] - pageY) / pageHeight;
            [tx, ty] = [-tx, -ty];
            break;
          case 270:
            posX = baseX + (position[0] - pageX - this.height * pageHeight) / pageWidth;
            posY = baseY + (position[1] - pageY - this.width * pageWidth) / pageHeight;
            [tx, ty] = [-ty, tx];
            break;
        }
        this.setAt(posX * parentWidth, posY * parentHeight, tx, ty);
      } else {
        this.setAt(baseX * parentWidth, baseY * parentHeight, this.width * parentWidth, this.height * parentHeight);
      }
      this.#setContent();
      this._isDraggable = true;
      this.editorDiv.contentEditable = false;
    } else {
      this._isDraggable = false;
      this.editorDiv.contentEditable = true;
    }
    return this.div;
  }
  static #getNodeContent(node) {
    return (node.nodeType === Node.TEXT_NODE ? node.nodeValue : node.innerText).replaceAll(EOL_PATTERN, "");
  }
  editorDivPaste(event) {
    const clipboardData = event.clipboardData || window.clipboardData;
    const {
      types
    } = clipboardData;
    if (types.length === 1 && types[0] === "text/plain") {
      return;
    }
    event.preventDefault();
    const paste = _FreeTextEditor.#deserializeContent(clipboardData.getData("text") || "").replaceAll(EOL_PATTERN, "\n");
    if (!paste) {
      return;
    }
    const selection = window.getSelection();
    if (!selection.rangeCount) {
      return;
    }
    this.editorDiv.normalize();
    selection.deleteFromDocument();
    const range = selection.getRangeAt(0);
    if (!paste.includes("\n")) {
      range.insertNode(document.createTextNode(paste));
      this.editorDiv.normalize();
      selection.collapseToStart();
      return;
    }
    const {
      startContainer,
      startOffset
    } = range;
    const bufferBefore = [];
    const bufferAfter = [];
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const parent = startContainer.parentElement;
      bufferAfter.push(startContainer.nodeValue.slice(startOffset).replaceAll(EOL_PATTERN, ""));
      if (parent !== this.editorDiv) {
        let buffer = bufferBefore;
        for (const child of this.editorDiv.childNodes) {
          if (child === parent) {
            buffer = bufferAfter;
            continue;
          }
          buffer.push(_FreeTextEditor.#getNodeContent(child));
        }
      }
      bufferBefore.push(startContainer.nodeValue.slice(0, startOffset).replaceAll(EOL_PATTERN, ""));
    } else if (startContainer === this.editorDiv) {
      let buffer = bufferBefore;
      let i = 0;
      for (const child of this.editorDiv.childNodes) {
        if (i++ === startOffset) {
          buffer = bufferAfter;
        }
        buffer.push(_FreeTextEditor.#getNodeContent(child));
      }
    }
    this.#content = `${bufferBefore.join("\n")}${paste}${bufferAfter.join("\n")}`;
    this.#setContent();
    const newRange = new Range();
    let beforeLength = bufferBefore.reduce((acc, line) => acc + line.length, 0);
    for (const {
      firstChild
    } of this.editorDiv.childNodes) {
      if (firstChild.nodeType === Node.TEXT_NODE) {
        const length = firstChild.nodeValue.length;
        if (beforeLength <= length) {
          newRange.setStart(firstChild, beforeLength);
          newRange.setEnd(firstChild, beforeLength);
          break;
        }
        beforeLength -= length;
      }
    }
    selection.removeAllRanges();
    selection.addRange(newRange);
  }
  #setContent() {
    this.editorDiv.replaceChildren();
    if (!this.#content) {
      return;
    }
    for (const line of this.#content.split("\n")) {
      const div = document.createElement("div");
      div.append(line ? document.createTextNode(line) : document.createElement("br"));
      this.editorDiv.append(div);
    }
  }
  #serializeContent() {
    return this.#content.replaceAll("\xA0", " ");
  }
  static #deserializeContent(content) {
    return content.replaceAll(" ", "\xA0");
  }
  get contentDiv() {
    return this.editorDiv;
  }
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    if (data instanceof FreeTextAnnotationElement) {
      const {
        data: {
          defaultAppearanceData: {
            fontSize,
            fontColor
          },
          rect,
          rotation,
          id,
          popupRef
        },
        textContent,
        textPosition,
        parent: {
          page: {
            pageNumber
          }
        }
      } = data;
      if (!textContent || textContent.length === 0) {
        return null;
      }
      initialData = data = {
        annotationType: AnnotationEditorType.FREETEXT,
        color: Array.from(fontColor),
        fontSize,
        value: textContent.join("\n"),
        position: textPosition,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        id,
        deleted: false,
        popupRef
      };
    }
    const editor = await super.deserialize(data, parent, uiManager);
    editor.#fontSize = data.fontSize;
    editor.#color = Util.makeHexColor(...data.color);
    editor.#content = _FreeTextEditor.#deserializeContent(data.value);
    editor.annotationElementId = data.id || null;
    editor._initialData = initialData;
    return editor;
  }
  serialize(isForCopying = false) {
    if (this.isEmpty()) {
      return null;
    }
    if (this.deleted) {
      return this.serializeDeleted();
    }
    const padding = _FreeTextEditor._internalPadding * this.parentScale;
    const rect = this.getRect(padding, padding);
    const color = AnnotationEditor._colorManager.convert(this.isAttachedToDOM ? getComputedStyle(this.editorDiv).color : this.#color);
    const serialized = {
      annotationType: AnnotationEditorType.FREETEXT,
      color,
      fontSize: this.#fontSize,
      value: this.#serializeContent(),
      pageIndex: this.pageIndex,
      rect,
      rotation: this.rotation,
      structTreeParentId: this._structTreeParentId
    };
    if (isForCopying) {
      return serialized;
    }
    if (this.annotationElementId && !this.#hasElementChanged(serialized)) {
      return null;
    }
    serialized.id = this.annotationElementId;
    return serialized;
  }
  #hasElementChanged(serialized) {
    const {
      value,
      fontSize,
      color,
      pageIndex
    } = this._initialData;
    return this._hasBeenMoved || serialized.value !== value || serialized.fontSize !== fontSize || serialized.color.some((c, i) => c !== color[i]) || serialized.pageIndex !== pageIndex;
  }
  renderAnnotationElement(annotation) {
    const content = super.renderAnnotationElement(annotation);
    if (this.deleted) {
      return content;
    }
    const {
      style
    } = content;
    style.fontSize = `calc(${this.#fontSize}px * var(--scale-factor))`;
    style.color = this.#color;
    content.replaceChildren();
    for (const line of this.#content.split("\n")) {
      const div = document.createElement("div");
      div.append(line ? document.createTextNode(line) : document.createElement("br"));
      content.append(div);
    }
    const padding = _FreeTextEditor._internalPadding * this.parentScale;
    annotation.updateEdited({
      rect: this.getRect(padding, padding),
      popupContent: this.#content
    });
    return content;
  }
  resetAnnotationElement(annotation) {
    super.resetAnnotationElement(annotation);
    annotation.resetEdited();
  }
};
var Outline = class {
  static PRECISION = 1e-4;
  toSVGPath() {
    unreachable("Abstract method `toSVGPath` must be implemented.");
  }
  get box() {
    unreachable("Abstract getter `box` must be implemented.");
  }
  serialize(_bbox, _rotation) {
    unreachable("Abstract method `serialize` must be implemented.");
  }
  static _rescale(src, tx, ty, sx, sy, dest) {
    dest ||= new Float32Array(src.length);
    for (let i = 0, ii = src.length; i < ii; i += 2) {
      dest[i] = tx + src[i] * sx;
      dest[i + 1] = ty + src[i + 1] * sy;
    }
    return dest;
  }
  static _rescaleAndSwap(src, tx, ty, sx, sy, dest) {
    dest ||= new Float32Array(src.length);
    for (let i = 0, ii = src.length; i < ii; i += 2) {
      dest[i] = tx + src[i + 1] * sx;
      dest[i + 1] = ty + src[i] * sy;
    }
    return dest;
  }
  static _translate(src, tx, ty, dest) {
    dest ||= new Float32Array(src.length);
    for (let i = 0, ii = src.length; i < ii; i += 2) {
      dest[i] = tx + src[i];
      dest[i + 1] = ty + src[i + 1];
    }
    return dest;
  }
  static svgRound(x) {
    return Math.round(x * 1e4);
  }
  static _normalizePoint(x, y, parentWidth, parentHeight, rotation) {
    switch (rotation) {
      case 90:
        return [1 - y / parentWidth, x / parentHeight];
      case 180:
        return [1 - x / parentWidth, 1 - y / parentHeight];
      case 270:
        return [y / parentWidth, 1 - x / parentHeight];
      default:
        return [x / parentWidth, y / parentHeight];
    }
  }
  static _normalizePagePoint(x, y, rotation) {
    switch (rotation) {
      case 90:
        return [1 - y, x];
      case 180:
        return [1 - x, 1 - y];
      case 270:
        return [y, 1 - x];
      default:
        return [x, y];
    }
  }
  static createBezierPoints(x1, y1, x2, y2, x3, y3) {
    return [(x1 + 5 * x2) / 6, (y1 + 5 * y2) / 6, (5 * x2 + x3) / 6, (5 * y2 + y3) / 6, (x2 + x3) / 2, (y2 + y3) / 2];
  }
};
var FreeDrawOutliner = class _FreeDrawOutliner {
  #box;
  #bottom = [];
  #innerMargin;
  #isLTR;
  #top = [];
  #last = new Float32Array(18);
  #lastX;
  #lastY;
  #min;
  #min_dist;
  #scaleFactor;
  #thickness;
  #points = [];
  static #MIN_DIST = 8;
  static #MIN_DIFF = 2;
  static #MIN = _FreeDrawOutliner.#MIN_DIST + _FreeDrawOutliner.#MIN_DIFF;
  constructor({
    x,
    y
  }, box, scaleFactor, thickness, isLTR, innerMargin = 0) {
    this.#box = box;
    this.#thickness = thickness * scaleFactor;
    this.#isLTR = isLTR;
    this.#last.set([NaN, NaN, NaN, NaN, x, y], 6);
    this.#innerMargin = innerMargin;
    this.#min_dist = _FreeDrawOutliner.#MIN_DIST * scaleFactor;
    this.#min = _FreeDrawOutliner.#MIN * scaleFactor;
    this.#scaleFactor = scaleFactor;
    this.#points.push(x, y);
  }
  isEmpty() {
    return isNaN(this.#last[8]);
  }
  #getLastCoords() {
    const lastTop = this.#last.subarray(4, 6);
    const lastBottom = this.#last.subarray(16, 18);
    const [x, y, width, height] = this.#box;
    return [(this.#lastX + (lastTop[0] - lastBottom[0]) / 2 - x) / width, (this.#lastY + (lastTop[1] - lastBottom[1]) / 2 - y) / height, (this.#lastX + (lastBottom[0] - lastTop[0]) / 2 - x) / width, (this.#lastY + (lastBottom[1] - lastTop[1]) / 2 - y) / height];
  }
  add({
    x,
    y
  }) {
    this.#lastX = x;
    this.#lastY = y;
    const [layerX, layerY, layerWidth, layerHeight] = this.#box;
    let [x1, y1, x2, y2] = this.#last.subarray(8, 12);
    const diffX = x - x2;
    const diffY = y - y2;
    const d = Math.hypot(diffX, diffY);
    if (d < this.#min) {
      return false;
    }
    const diffD = d - this.#min_dist;
    const K = diffD / d;
    const shiftX = K * diffX;
    const shiftY = K * diffY;
    let x0 = x1;
    let y0 = y1;
    x1 = x2;
    y1 = y2;
    x2 += shiftX;
    y2 += shiftY;
    this.#points?.push(x, y);
    const nX = -shiftY / diffD;
    const nY = shiftX / diffD;
    const thX = nX * this.#thickness;
    const thY = nY * this.#thickness;
    this.#last.set(this.#last.subarray(2, 8), 0);
    this.#last.set([x2 + thX, y2 + thY], 4);
    this.#last.set(this.#last.subarray(14, 18), 12);
    this.#last.set([x2 - thX, y2 - thY], 16);
    if (isNaN(this.#last[6])) {
      if (this.#top.length === 0) {
        this.#last.set([x1 + thX, y1 + thY], 2);
        this.#top.push(NaN, NaN, NaN, NaN, (x1 + thX - layerX) / layerWidth, (y1 + thY - layerY) / layerHeight);
        this.#last.set([x1 - thX, y1 - thY], 14);
        this.#bottom.push(NaN, NaN, NaN, NaN, (x1 - thX - layerX) / layerWidth, (y1 - thY - layerY) / layerHeight);
      }
      this.#last.set([x0, y0, x1, y1, x2, y2], 6);
      return !this.isEmpty();
    }
    this.#last.set([x0, y0, x1, y1, x2, y2], 6);
    const angle = Math.abs(Math.atan2(y0 - y1, x0 - x1) - Math.atan2(shiftY, shiftX));
    if (angle < Math.PI / 2) {
      [x1, y1, x2, y2] = this.#last.subarray(2, 6);
      this.#top.push(NaN, NaN, NaN, NaN, ((x1 + x2) / 2 - layerX) / layerWidth, ((y1 + y2) / 2 - layerY) / layerHeight);
      [x1, y1, x0, y0] = this.#last.subarray(14, 18);
      this.#bottom.push(NaN, NaN, NaN, NaN, ((x0 + x1) / 2 - layerX) / layerWidth, ((y0 + y1) / 2 - layerY) / layerHeight);
      return true;
    }
    [x0, y0, x1, y1, x2, y2] = this.#last.subarray(0, 6);
    this.#top.push(((x0 + 5 * x1) / 6 - layerX) / layerWidth, ((y0 + 5 * y1) / 6 - layerY) / layerHeight, ((5 * x1 + x2) / 6 - layerX) / layerWidth, ((5 * y1 + y2) / 6 - layerY) / layerHeight, ((x1 + x2) / 2 - layerX) / layerWidth, ((y1 + y2) / 2 - layerY) / layerHeight);
    [x2, y2, x1, y1, x0, y0] = this.#last.subarray(12, 18);
    this.#bottom.push(((x0 + 5 * x1) / 6 - layerX) / layerWidth, ((y0 + 5 * y1) / 6 - layerY) / layerHeight, ((5 * x1 + x2) / 6 - layerX) / layerWidth, ((5 * y1 + y2) / 6 - layerY) / layerHeight, ((x1 + x2) / 2 - layerX) / layerWidth, ((y1 + y2) / 2 - layerY) / layerHeight);
    return true;
  }
  toSVGPath() {
    if (this.isEmpty()) {
      return "";
    }
    const top = this.#top;
    const bottom = this.#bottom;
    if (isNaN(this.#last[6]) && !this.isEmpty()) {
      return this.#toSVGPathTwoPoints();
    }
    const buffer = [];
    buffer.push(`M${top[4]} ${top[5]}`);
    for (let i = 6; i < top.length; i += 6) {
      if (isNaN(top[i])) {
        buffer.push(`L${top[i + 4]} ${top[i + 5]}`);
      } else {
        buffer.push(`C${top[i]} ${top[i + 1]} ${top[i + 2]} ${top[i + 3]} ${top[i + 4]} ${top[i + 5]}`);
      }
    }
    this.#toSVGPathEnd(buffer);
    for (let i = bottom.length - 6; i >= 6; i -= 6) {
      if (isNaN(bottom[i])) {
        buffer.push(`L${bottom[i + 4]} ${bottom[i + 5]}`);
      } else {
        buffer.push(`C${bottom[i]} ${bottom[i + 1]} ${bottom[i + 2]} ${bottom[i + 3]} ${bottom[i + 4]} ${bottom[i + 5]}`);
      }
    }
    this.#toSVGPathStart(buffer);
    return buffer.join(" ");
  }
  #toSVGPathTwoPoints() {
    const [x, y, width, height] = this.#box;
    const [lastTopX, lastTopY, lastBottomX, lastBottomY] = this.#getLastCoords();
    return `M${(this.#last[2] - x) / width} ${(this.#last[3] - y) / height} L${(this.#last[4] - x) / width} ${(this.#last[5] - y) / height} L${lastTopX} ${lastTopY} L${lastBottomX} ${lastBottomY} L${(this.#last[16] - x) / width} ${(this.#last[17] - y) / height} L${(this.#last[14] - x) / width} ${(this.#last[15] - y) / height} Z`;
  }
  #toSVGPathStart(buffer) {
    const bottom = this.#bottom;
    buffer.push(`L${bottom[4]} ${bottom[5]} Z`);
  }
  #toSVGPathEnd(buffer) {
    const [x, y, width, height] = this.#box;
    const lastTop = this.#last.subarray(4, 6);
    const lastBottom = this.#last.subarray(16, 18);
    const [lastTopX, lastTopY, lastBottomX, lastBottomY] = this.#getLastCoords();
    buffer.push(`L${(lastTop[0] - x) / width} ${(lastTop[1] - y) / height} L${lastTopX} ${lastTopY} L${lastBottomX} ${lastBottomY} L${(lastBottom[0] - x) / width} ${(lastBottom[1] - y) / height}`);
  }
  newFreeDrawOutline(outline, points, box, scaleFactor, innerMargin, isLTR) {
    return new FreeDrawOutline(outline, points, box, scaleFactor, innerMargin, isLTR);
  }
  getOutlines() {
    const top = this.#top;
    const bottom = this.#bottom;
    const last = this.#last;
    const [layerX, layerY, layerWidth, layerHeight] = this.#box;
    const points = new Float32Array((this.#points?.length ?? 0) + 2);
    for (let i = 0, ii = points.length - 2; i < ii; i += 2) {
      points[i] = (this.#points[i] - layerX) / layerWidth;
      points[i + 1] = (this.#points[i + 1] - layerY) / layerHeight;
    }
    points[points.length - 2] = (this.#lastX - layerX) / layerWidth;
    points[points.length - 1] = (this.#lastY - layerY) / layerHeight;
    if (isNaN(last[6]) && !this.isEmpty()) {
      return this.#getOutlineTwoPoints(points);
    }
    const outline = new Float32Array(this.#top.length + 24 + this.#bottom.length);
    let N = top.length;
    for (let i = 0; i < N; i += 2) {
      if (isNaN(top[i])) {
        outline[i] = outline[i + 1] = NaN;
        continue;
      }
      outline[i] = top[i];
      outline[i + 1] = top[i + 1];
    }
    N = this.#getOutlineEnd(outline, N);
    for (let i = bottom.length - 6; i >= 6; i -= 6) {
      for (let j = 0; j < 6; j += 2) {
        if (isNaN(bottom[i + j])) {
          outline[N] = outline[N + 1] = NaN;
          N += 2;
          continue;
        }
        outline[N] = bottom[i + j];
        outline[N + 1] = bottom[i + j + 1];
        N += 2;
      }
    }
    this.#getOutlineStart(outline, N);
    return this.newFreeDrawOutline(outline, points, this.#box, this.#scaleFactor, this.#innerMargin, this.#isLTR);
  }
  #getOutlineTwoPoints(points) {
    const last = this.#last;
    const [layerX, layerY, layerWidth, layerHeight] = this.#box;
    const [lastTopX, lastTopY, lastBottomX, lastBottomY] = this.#getLastCoords();
    const outline = new Float32Array(36);
    outline.set([NaN, NaN, NaN, NaN, (last[2] - layerX) / layerWidth, (last[3] - layerY) / layerHeight, NaN, NaN, NaN, NaN, (last[4] - layerX) / layerWidth, (last[5] - layerY) / layerHeight, NaN, NaN, NaN, NaN, lastTopX, lastTopY, NaN, NaN, NaN, NaN, lastBottomX, lastBottomY, NaN, NaN, NaN, NaN, (last[16] - layerX) / layerWidth, (last[17] - layerY) / layerHeight, NaN, NaN, NaN, NaN, (last[14] - layerX) / layerWidth, (last[15] - layerY) / layerHeight], 0);
    return this.newFreeDrawOutline(outline, points, this.#box, this.#scaleFactor, this.#innerMargin, this.#isLTR);
  }
  #getOutlineStart(outline, pos) {
    const bottom = this.#bottom;
    outline.set([NaN, NaN, NaN, NaN, bottom[4], bottom[5]], pos);
    return pos += 6;
  }
  #getOutlineEnd(outline, pos) {
    const lastTop = this.#last.subarray(4, 6);
    const lastBottom = this.#last.subarray(16, 18);
    const [layerX, layerY, layerWidth, layerHeight] = this.#box;
    const [lastTopX, lastTopY, lastBottomX, lastBottomY] = this.#getLastCoords();
    outline.set([NaN, NaN, NaN, NaN, (lastTop[0] - layerX) / layerWidth, (lastTop[1] - layerY) / layerHeight, NaN, NaN, NaN, NaN, lastTopX, lastTopY, NaN, NaN, NaN, NaN, lastBottomX, lastBottomY, NaN, NaN, NaN, NaN, (lastBottom[0] - layerX) / layerWidth, (lastBottom[1] - layerY) / layerHeight], pos);
    return pos += 24;
  }
};
var FreeDrawOutline = class extends Outline {
  #box;
  #bbox = new Float32Array(4);
  #innerMargin;
  #isLTR;
  #points;
  #scaleFactor;
  #outline;
  constructor(outline, points, box, scaleFactor, innerMargin, isLTR) {
    super();
    this.#outline = outline;
    this.#points = points;
    this.#box = box;
    this.#scaleFactor = scaleFactor;
    this.#innerMargin = innerMargin;
    this.#isLTR = isLTR;
    this.lastPoint = [NaN, NaN];
    this.#computeMinMax(isLTR);
    const [x, y, width, height] = this.#bbox;
    for (let i = 0, ii = outline.length; i < ii; i += 2) {
      outline[i] = (outline[i] - x) / width;
      outline[i + 1] = (outline[i + 1] - y) / height;
    }
    for (let i = 0, ii = points.length; i < ii; i += 2) {
      points[i] = (points[i] - x) / width;
      points[i + 1] = (points[i + 1] - y) / height;
    }
  }
  toSVGPath() {
    const buffer = [`M${this.#outline[4]} ${this.#outline[5]}`];
    for (let i = 6, ii = this.#outline.length; i < ii; i += 6) {
      if (isNaN(this.#outline[i])) {
        buffer.push(`L${this.#outline[i + 4]} ${this.#outline[i + 5]}`);
        continue;
      }
      buffer.push(`C${this.#outline[i]} ${this.#outline[i + 1]} ${this.#outline[i + 2]} ${this.#outline[i + 3]} ${this.#outline[i + 4]} ${this.#outline[i + 5]}`);
    }
    buffer.push("Z");
    return buffer.join(" ");
  }
  serialize([blX, blY, trX, trY], rotation) {
    const width = trX - blX;
    const height = trY - blY;
    let outline;
    let points;
    switch (rotation) {
      case 0:
        outline = Outline._rescale(this.#outline, blX, trY, width, -height);
        points = Outline._rescale(this.#points, blX, trY, width, -height);
        break;
      case 90:
        outline = Outline._rescaleAndSwap(this.#outline, blX, blY, width, height);
        points = Outline._rescaleAndSwap(this.#points, blX, blY, width, height);
        break;
      case 180:
        outline = Outline._rescale(this.#outline, trX, blY, -width, height);
        points = Outline._rescale(this.#points, trX, blY, -width, height);
        break;
      case 270:
        outline = Outline._rescaleAndSwap(this.#outline, trX, trY, -width, -height);
        points = Outline._rescaleAndSwap(this.#points, trX, trY, -width, -height);
        break;
    }
    return {
      outline: Array.from(outline),
      points: [Array.from(points)]
    };
  }
  #computeMinMax(isLTR) {
    const outline = this.#outline;
    let lastX = outline[4];
    let lastY = outline[5];
    let minX = lastX;
    let minY = lastY;
    let maxX = lastX;
    let maxY = lastY;
    let lastPointX = lastX;
    let lastPointY = lastY;
    const ltrCallback = isLTR ? Math.max : Math.min;
    for (let i = 6, ii = outline.length; i < ii; i += 6) {
      if (isNaN(outline[i])) {
        minX = Math.min(minX, outline[i + 4]);
        minY = Math.min(minY, outline[i + 5]);
        maxX = Math.max(maxX, outline[i + 4]);
        maxY = Math.max(maxY, outline[i + 5]);
        if (lastPointY < outline[i + 5]) {
          lastPointX = outline[i + 4];
          lastPointY = outline[i + 5];
        } else if (lastPointY === outline[i + 5]) {
          lastPointX = ltrCallback(lastPointX, outline[i + 4]);
        }
      } else {
        const bbox2 = Util.bezierBoundingBox(lastX, lastY, ...outline.slice(i, i + 6));
        minX = Math.min(minX, bbox2[0]);
        minY = Math.min(minY, bbox2[1]);
        maxX = Math.max(maxX, bbox2[2]);
        maxY = Math.max(maxY, bbox2[3]);
        if (lastPointY < bbox2[3]) {
          lastPointX = bbox2[2];
          lastPointY = bbox2[3];
        } else if (lastPointY === bbox2[3]) {
          lastPointX = ltrCallback(lastPointX, bbox2[2]);
        }
      }
      lastX = outline[i + 4];
      lastY = outline[i + 5];
    }
    const bbox = this.#bbox;
    bbox[0] = minX - this.#innerMargin;
    bbox[1] = minY - this.#innerMargin;
    bbox[2] = maxX - minX + 2 * this.#innerMargin;
    bbox[3] = maxY - minY + 2 * this.#innerMargin;
    this.lastPoint = [lastPointX, lastPointY];
  }
  get box() {
    return this.#bbox;
  }
  newOutliner(point, box, scaleFactor, thickness, isLTR, innerMargin = 0) {
    return new FreeDrawOutliner(point, box, scaleFactor, thickness, isLTR, innerMargin);
  }
  getNewOutline(thickness, innerMargin) {
    const [x, y, width, height] = this.#bbox;
    const [layerX, layerY, layerWidth, layerHeight] = this.#box;
    const sx = width * layerWidth;
    const sy = height * layerHeight;
    const tx = x * layerWidth + layerX;
    const ty = y * layerHeight + layerY;
    const outliner = this.newOutliner({
      x: this.#points[0] * sx + tx,
      y: this.#points[1] * sy + ty
    }, this.#box, this.#scaleFactor, thickness, this.#isLTR, innerMargin ?? this.#innerMargin);
    for (let i = 2; i < this.#points.length; i += 2) {
      outliner.add({
        x: this.#points[i] * sx + tx,
        y: this.#points[i + 1] * sy + ty
      });
    }
    return outliner.getOutlines();
  }
};
var HighlightOutliner = class {
  #box;
  #lastPoint;
  #verticalEdges = [];
  #intervals = [];
  constructor(boxes, borderWidth = 0, innerMargin = 0, isLTR = true) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const NUMBER_OF_DIGITS = 4;
    const EPSILON = 10 ** -NUMBER_OF_DIGITS;
    for (const {
      x,
      y,
      width,
      height
    } of boxes) {
      const x1 = Math.floor((x - borderWidth) / EPSILON) * EPSILON;
      const x2 = Math.ceil((x + width + borderWidth) / EPSILON) * EPSILON;
      const y1 = Math.floor((y - borderWidth) / EPSILON) * EPSILON;
      const y2 = Math.ceil((y + height + borderWidth) / EPSILON) * EPSILON;
      const left = [x1, y1, y2, true];
      const right = [x2, y1, y2, false];
      this.#verticalEdges.push(left, right);
      minX = Math.min(minX, x1);
      maxX = Math.max(maxX, x2);
      minY = Math.min(minY, y1);
      maxY = Math.max(maxY, y2);
    }
    const bboxWidth = maxX - minX + 2 * innerMargin;
    const bboxHeight = maxY - minY + 2 * innerMargin;
    const shiftedMinX = minX - innerMargin;
    const shiftedMinY = minY - innerMargin;
    const lastEdge = this.#verticalEdges.at(isLTR ? -1 : -2);
    const lastPoint = [lastEdge[0], lastEdge[2]];
    for (const edge of this.#verticalEdges) {
      const [x, y1, y2] = edge;
      edge[0] = (x - shiftedMinX) / bboxWidth;
      edge[1] = (y1 - shiftedMinY) / bboxHeight;
      edge[2] = (y2 - shiftedMinY) / bboxHeight;
    }
    this.#box = new Float32Array([shiftedMinX, shiftedMinY, bboxWidth, bboxHeight]);
    this.#lastPoint = lastPoint;
  }
  getOutlines() {
    this.#verticalEdges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const outlineVerticalEdges = [];
    for (const edge of this.#verticalEdges) {
      if (edge[3]) {
        outlineVerticalEdges.push(...this.#breakEdge(edge));
        this.#insert(edge);
      } else {
        this.#remove(edge);
        outlineVerticalEdges.push(...this.#breakEdge(edge));
      }
    }
    return this.#getOutlines(outlineVerticalEdges);
  }
  #getOutlines(outlineVerticalEdges) {
    const edges = [];
    const allEdges = /* @__PURE__ */ new Set();
    for (const edge of outlineVerticalEdges) {
      const [x, y1, y2] = edge;
      edges.push([x, y1, edge], [x, y2, edge]);
    }
    edges.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (let i = 0, ii = edges.length; i < ii; i += 2) {
      const edge1 = edges[i][2];
      const edge2 = edges[i + 1][2];
      edge1.push(edge2);
      edge2.push(edge1);
      allEdges.add(edge1);
      allEdges.add(edge2);
    }
    const outlines = [];
    let outline;
    while (allEdges.size > 0) {
      const edge = allEdges.values().next().value;
      let [x, y1, y2, edge1, edge2] = edge;
      allEdges.delete(edge);
      let lastPointX = x;
      let lastPointY = y1;
      outline = [x, y2];
      outlines.push(outline);
      while (true) {
        let e;
        if (allEdges.has(edge1)) {
          e = edge1;
        } else if (allEdges.has(edge2)) {
          e = edge2;
        } else {
          break;
        }
        allEdges.delete(e);
        [x, y1, y2, edge1, edge2] = e;
        if (lastPointX !== x) {
          outline.push(lastPointX, lastPointY, x, lastPointY === y1 ? y1 : y2);
          lastPointX = x;
        }
        lastPointY = lastPointY === y1 ? y2 : y1;
      }
      outline.push(lastPointX, lastPointY);
    }
    return new HighlightOutline(outlines, this.#box, this.#lastPoint);
  }
  #binarySearch(y) {
    const array = this.#intervals;
    let start = 0;
    let end = array.length - 1;
    while (start <= end) {
      const middle = start + end >> 1;
      const y1 = array[middle][0];
      if (y1 === y) {
        return middle;
      }
      if (y1 < y) {
        start = middle + 1;
      } else {
        end = middle - 1;
      }
    }
    return end + 1;
  }
  #insert([, y1, y2]) {
    const index = this.#binarySearch(y1);
    this.#intervals.splice(index, 0, [y1, y2]);
  }
  #remove([, y1, y2]) {
    const index = this.#binarySearch(y1);
    for (let i = index; i < this.#intervals.length; i++) {
      const [start, end] = this.#intervals[i];
      if (start !== y1) {
        break;
      }
      if (start === y1 && end === y2) {
        this.#intervals.splice(i, 1);
        return;
      }
    }
    for (let i = index - 1; i >= 0; i--) {
      const [start, end] = this.#intervals[i];
      if (start !== y1) {
        break;
      }
      if (start === y1 && end === y2) {
        this.#intervals.splice(i, 1);
        return;
      }
    }
  }
  #breakEdge(edge) {
    const [x, y1, y2] = edge;
    const results = [[x, y1, y2]];
    const index = this.#binarySearch(y2);
    for (let i = 0; i < index; i++) {
      const [start, end] = this.#intervals[i];
      for (let j = 0, jj = results.length; j < jj; j++) {
        const [, y3, y4] = results[j];
        if (end <= y3 || y4 <= start) {
          continue;
        }
        if (y3 >= start) {
          if (y4 > end) {
            results[j][1] = end;
          } else {
            if (jj === 1) {
              return [];
            }
            results.splice(j, 1);
            j--;
            jj--;
          }
          continue;
        }
        results[j][2] = start;
        if (y4 > end) {
          results.push([x, end, y4]);
        }
      }
    }
    return results;
  }
};
var HighlightOutline = class extends Outline {
  #box;
  #outlines;
  constructor(outlines, box, lastPoint) {
    super();
    this.#outlines = outlines;
    this.#box = box;
    this.lastPoint = lastPoint;
  }
  toSVGPath() {
    const buffer = [];
    for (const polygon of this.#outlines) {
      let [prevX, prevY] = polygon;
      buffer.push(`M${prevX} ${prevY}`);
      for (let i = 2; i < polygon.length; i += 2) {
        const x = polygon[i];
        const y = polygon[i + 1];
        if (x === prevX) {
          buffer.push(`V${y}`);
          prevY = y;
        } else if (y === prevY) {
          buffer.push(`H${x}`);
          prevX = x;
        }
      }
      buffer.push("Z");
    }
    return buffer.join(" ");
  }
  serialize([blX, blY, trX, trY], _rotation) {
    const outlines = [];
    const width = trX - blX;
    const height = trY - blY;
    for (const outline of this.#outlines) {
      const points = new Array(outline.length);
      for (let i = 0; i < outline.length; i += 2) {
        points[i] = blX + outline[i] * width;
        points[i + 1] = trY - outline[i + 1] * height;
      }
      outlines.push(points);
    }
    return outlines;
  }
  get box() {
    return this.#box;
  }
  get classNamesForOutlining() {
    return ["highlightOutline"];
  }
};
var FreeHighlightOutliner = class extends FreeDrawOutliner {
  newFreeDrawOutline(outline, points, box, scaleFactor, innerMargin, isLTR) {
    return new FreeHighlightOutline(outline, points, box, scaleFactor, innerMargin, isLTR);
  }
};
var FreeHighlightOutline = class extends FreeDrawOutline {
  newOutliner(point, box, scaleFactor, thickness, isLTR, innerMargin = 0) {
    return new FreeHighlightOutliner(point, box, scaleFactor, thickness, isLTR, innerMargin);
  }
};
var ColorPicker = class _ColorPicker {
  #button = null;
  #buttonSwatch = null;
  #defaultColor;
  #dropdown = null;
  #dropdownWasFromKeyboard = false;
  #isMainColorPicker = false;
  #editor = null;
  #eventBus;
  #openDropdownAC = null;
  #uiManager = null;
  #type;
  static #l10nColor = null;
  static get _keyboardManager() {
    return shadow(this, "_keyboardManager", new KeyboardManager([[["Escape", "mac+Escape"], _ColorPicker.prototype._hideDropdownFromKeyboard], [[" ", "mac+ "], _ColorPicker.prototype._colorSelectFromKeyboard], [["ArrowDown", "ArrowRight", "mac+ArrowDown", "mac+ArrowRight"], _ColorPicker.prototype._moveToNext], [["ArrowUp", "ArrowLeft", "mac+ArrowUp", "mac+ArrowLeft"], _ColorPicker.prototype._moveToPrevious], [["Home", "mac+Home"], _ColorPicker.prototype._moveToBeginning], [["End", "mac+End"], _ColorPicker.prototype._moveToEnd]]));
  }
  constructor({
    editor = null,
    uiManager = null
  }) {
    if (editor) {
      this.#isMainColorPicker = false;
      this.#type = AnnotationEditorParamsType.HIGHLIGHT_COLOR;
      this.#editor = editor;
    } else {
      this.#isMainColorPicker = true;
      this.#type = AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR;
    }
    this.#uiManager = editor?._uiManager || uiManager;
    this.#eventBus = this.#uiManager._eventBus;
    this.#defaultColor = editor?.color || this.#uiManager?.highlightColors.values().next().value || "#FFFF98";
    _ColorPicker.#l10nColor ||= Object.freeze({
      blue: "pdfjs-editor-colorpicker-blue",
      green: "pdfjs-editor-colorpicker-green",
      pink: "pdfjs-editor-colorpicker-pink",
      red: "pdfjs-editor-colorpicker-red",
      yellow: "pdfjs-editor-colorpicker-yellow"
    });
  }
  renderButton() {
    const button = this.#button = document.createElement("button");
    button.className = "colorPicker";
    button.tabIndex = "0";
    button.setAttribute("data-l10n-id", "pdfjs-editor-colorpicker-button");
    button.setAttribute("aria-haspopup", true);
    const signal = this.#uiManager._signal;
    button.addEventListener("click", this.#openDropdown.bind(this), {
      signal
    });
    button.addEventListener("keydown", this.#keyDown.bind(this), {
      signal
    });
    const swatch = this.#buttonSwatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.setAttribute("aria-hidden", true);
    swatch.style.backgroundColor = this.#defaultColor;
    button.append(swatch);
    return button;
  }
  renderMainDropdown() {
    const dropdown = this.#dropdown = this.#getDropdownRoot();
    dropdown.setAttribute("aria-orientation", "horizontal");
    dropdown.setAttribute("aria-labelledby", "highlightColorPickerLabel");
    return dropdown;
  }
  #getDropdownRoot() {
    const div = document.createElement("div");
    const signal = this.#uiManager._signal;
    div.addEventListener("contextmenu", noContextMenu, {
      signal
    });
    div.className = "dropdown";
    div.role = "listbox";
    div.setAttribute("aria-multiselectable", false);
    div.setAttribute("aria-orientation", "vertical");
    div.setAttribute("data-l10n-id", "pdfjs-editor-colorpicker-dropdown");
    for (const [name, color] of this.#uiManager.highlightColors) {
      const button = document.createElement("button");
      button.tabIndex = "0";
      button.role = "option";
      button.setAttribute("data-color", color);
      button.title = name;
      button.setAttribute("data-l10n-id", _ColorPicker.#l10nColor[name]);
      const swatch = document.createElement("span");
      button.append(swatch);
      swatch.className = "swatch";
      swatch.style.backgroundColor = color;
      button.setAttribute("aria-selected", color === this.#defaultColor);
      button.addEventListener("click", this.#colorSelect.bind(this, color), {
        signal
      });
      div.append(button);
    }
    div.addEventListener("keydown", this.#keyDown.bind(this), {
      signal
    });
    return div;
  }
  #colorSelect(color, event) {
    event.stopPropagation();
    this.#eventBus.dispatch("switchannotationeditorparams", {
      source: this,
      type: this.#type,
      value: color
    });
  }
  _colorSelectFromKeyboard(event) {
    if (event.target === this.#button) {
      this.#openDropdown(event);
      return;
    }
    const color = event.target.getAttribute("data-color");
    if (!color) {
      return;
    }
    this.#colorSelect(color, event);
  }
  _moveToNext(event) {
    if (!this.#isDropdownVisible) {
      this.#openDropdown(event);
      return;
    }
    if (event.target === this.#button) {
      this.#dropdown.firstChild?.focus();
      return;
    }
    event.target.nextSibling?.focus();
  }
  _moveToPrevious(event) {
    if (event.target === this.#dropdown?.firstChild || event.target === this.#button) {
      if (this.#isDropdownVisible) {
        this._hideDropdownFromKeyboard();
      }
      return;
    }
    if (!this.#isDropdownVisible) {
      this.#openDropdown(event);
    }
    event.target.previousSibling?.focus();
  }
  _moveToBeginning(event) {
    if (!this.#isDropdownVisible) {
      this.#openDropdown(event);
      return;
    }
    this.#dropdown.firstChild?.focus();
  }
  _moveToEnd(event) {
    if (!this.#isDropdownVisible) {
      this.#openDropdown(event);
      return;
    }
    this.#dropdown.lastChild?.focus();
  }
  #keyDown(event) {
    _ColorPicker._keyboardManager.exec(this, event);
  }
  #openDropdown(event) {
    if (this.#isDropdownVisible) {
      this.hideDropdown();
      return;
    }
    this.#dropdownWasFromKeyboard = event.detail === 0;
    if (!this.#openDropdownAC) {
      this.#openDropdownAC = new AbortController();
      window.addEventListener("pointerdown", this.#pointerDown.bind(this), {
        signal: this.#uiManager.combinedSignal(this.#openDropdownAC)
      });
    }
    if (this.#dropdown) {
      this.#dropdown.classList.remove("hidden");
      return;
    }
    const root = this.#dropdown = this.#getDropdownRoot();
    this.#button.append(root);
  }
  #pointerDown(event) {
    if (this.#dropdown?.contains(event.target)) {
      return;
    }
    this.hideDropdown();
  }
  hideDropdown() {
    this.#dropdown?.classList.add("hidden");
    this.#openDropdownAC?.abort();
    this.#openDropdownAC = null;
  }
  get #isDropdownVisible() {
    return this.#dropdown && !this.#dropdown.classList.contains("hidden");
  }
  _hideDropdownFromKeyboard() {
    if (this.#isMainColorPicker) {
      return;
    }
    if (!this.#isDropdownVisible) {
      this.#editor?.unselect();
      return;
    }
    this.hideDropdown();
    this.#button.focus({
      preventScroll: true,
      focusVisible: this.#dropdownWasFromKeyboard
    });
  }
  updateColor(color) {
    if (this.#buttonSwatch) {
      this.#buttonSwatch.style.backgroundColor = color;
    }
    if (!this.#dropdown) {
      return;
    }
    const i = this.#uiManager.highlightColors.values();
    for (const child of this.#dropdown.children) {
      child.setAttribute("aria-selected", i.next().value === color);
    }
  }
  destroy() {
    this.#button?.remove();
    this.#button = null;
    this.#buttonSwatch = null;
    this.#dropdown?.remove();
    this.#dropdown = null;
  }
};
var HighlightEditor = class _HighlightEditor extends AnnotationEditor {
  #anchorNode = null;
  #anchorOffset = 0;
  #boxes;
  #clipPathId = null;
  #colorPicker = null;
  #focusOutlines = null;
  #focusNode = null;
  #focusOffset = 0;
  #highlightDiv = null;
  #highlightOutlines = null;
  #id = null;
  #isFreeHighlight = false;
  #lastPoint = null;
  #opacity;
  #outlineId = null;
  #text = "";
  #thickness;
  #methodOfCreation = "";
  static _defaultColor = null;
  static _defaultOpacity = 1;
  static _defaultThickness = 12;
  static _type = "highlight";
  static _editorType = AnnotationEditorType.HIGHLIGHT;
  static _freeHighlightId = -1;
  static _freeHighlight = null;
  static _freeHighlightClipId = "";
  static get _keyboardManager() {
    const proto = _HighlightEditor.prototype;
    return shadow(this, "_keyboardManager", new KeyboardManager([[["ArrowLeft", "mac+ArrowLeft"], proto._moveCaret, {
      args: [0]
    }], [["ArrowRight", "mac+ArrowRight"], proto._moveCaret, {
      args: [1]
    }], [["ArrowUp", "mac+ArrowUp"], proto._moveCaret, {
      args: [2]
    }], [["ArrowDown", "mac+ArrowDown"], proto._moveCaret, {
      args: [3]
    }]]));
  }
  constructor(params) {
    super({
      ...params,
      name: "highlightEditor"
    });
    this.color = params.color || _HighlightEditor._defaultColor;
    this.#thickness = params.thickness || _HighlightEditor._defaultThickness;
    this.#opacity = params.opacity || _HighlightEditor._defaultOpacity;
    this.#boxes = params.boxes || null;
    this.#methodOfCreation = params.methodOfCreation || "";
    this.#text = params.text || "";
    this._isDraggable = false;
    if (params.highlightId > -1) {
      this.#isFreeHighlight = true;
      this.#createFreeOutlines(params);
      this.#addToDrawLayer();
    } else if (this.#boxes) {
      this.#anchorNode = params.anchorNode;
      this.#anchorOffset = params.anchorOffset;
      this.#focusNode = params.focusNode;
      this.#focusOffset = params.focusOffset;
      this.#createOutlines();
      this.#addToDrawLayer();
      this.rotate(this.rotation);
    }
  }
  get telemetryInitialData() {
    return {
      action: "added",
      type: this.#isFreeHighlight ? "free_highlight" : "highlight",
      color: this._uiManager.highlightColorNames.get(this.color),
      thickness: this.#thickness,
      methodOfCreation: this.#methodOfCreation
    };
  }
  get telemetryFinalData() {
    return {
      type: "highlight",
      color: this._uiManager.highlightColorNames.get(this.color)
    };
  }
  static computeTelemetryFinalData(data) {
    return {
      numberOfColors: data.get("color").size
    };
  }
  #createOutlines() {
    const outliner = new HighlightOutliner(this.#boxes, 1e-3);
    this.#highlightOutlines = outliner.getOutlines();
    [this.x, this.y, this.width, this.height] = this.#highlightOutlines.box;
    const outlinerForOutline = new HighlightOutliner(this.#boxes, 25e-4, 1e-3, this._uiManager.direction === "ltr");
    this.#focusOutlines = outlinerForOutline.getOutlines();
    const {
      lastPoint
    } = this.#focusOutlines;
    this.#lastPoint = [(lastPoint[0] - this.x) / this.width, (lastPoint[1] - this.y) / this.height];
  }
  #createFreeOutlines({
    highlightOutlines,
    highlightId,
    clipPathId
  }) {
    this.#highlightOutlines = highlightOutlines;
    const extraThickness = 1.5;
    this.#focusOutlines = highlightOutlines.getNewOutline(this.#thickness / 2 + extraThickness, 25e-4);
    if (highlightId >= 0) {
      this.#id = highlightId;
      this.#clipPathId = clipPathId;
      this.parent.drawLayer.finalizeDraw(highlightId, {
        bbox: highlightOutlines.box,
        path: {
          d: highlightOutlines.toSVGPath()
        }
      });
      this.#outlineId = this.parent.drawLayer.drawOutline({
        rootClass: {
          highlightOutline: true,
          free: true
        },
        bbox: this.#focusOutlines.box,
        path: {
          d: this.#focusOutlines.toSVGPath()
        }
      }, true);
    } else if (this.parent) {
      const angle = this.parent.viewport.rotation;
      this.parent.drawLayer.updateProperties(this.#id, {
        bbox: _HighlightEditor.#rotateBbox(this.#highlightOutlines.box, (angle - this.rotation + 360) % 360),
        path: {
          d: highlightOutlines.toSVGPath()
        }
      });
      this.parent.drawLayer.updateProperties(this.#outlineId, {
        bbox: _HighlightEditor.#rotateBbox(this.#focusOutlines.box, angle),
        path: {
          d: this.#focusOutlines.toSVGPath()
        }
      });
    }
    const [x, y, width, height] = highlightOutlines.box;
    switch (this.rotation) {
      case 0:
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        break;
      case 90: {
        const [pageWidth, pageHeight] = this.parentDimensions;
        this.x = y;
        this.y = 1 - x;
        this.width = width * pageHeight / pageWidth;
        this.height = height * pageWidth / pageHeight;
        break;
      }
      case 180:
        this.x = 1 - x;
        this.y = 1 - y;
        this.width = width;
        this.height = height;
        break;
      case 270: {
        const [pageWidth, pageHeight] = this.parentDimensions;
        this.x = 1 - y;
        this.y = x;
        this.width = width * pageHeight / pageWidth;
        this.height = height * pageWidth / pageHeight;
        break;
      }
    }
    const {
      lastPoint
    } = this.#focusOutlines;
    this.#lastPoint = [(lastPoint[0] - x) / width, (lastPoint[1] - y) / height];
  }
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
    _HighlightEditor._defaultColor ||= uiManager.highlightColors?.values().next().value || "#fff066";
  }
  static updateDefaultParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR:
        _HighlightEditor._defaultColor = value;
        break;
      case AnnotationEditorParamsType.HIGHLIGHT_THICKNESS:
        _HighlightEditor._defaultThickness = value;
        break;
    }
  }
  translateInPage(x, y) {
  }
  get toolbarPosition() {
    return this.#lastPoint;
  }
  updateParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.HIGHLIGHT_COLOR:
        this.#updateColor(value);
        break;
      case AnnotationEditorParamsType.HIGHLIGHT_THICKNESS:
        this.#updateThickness(value);
        break;
    }
  }
  static get defaultPropertiesToUpdate() {
    return [[AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR, _HighlightEditor._defaultColor], [AnnotationEditorParamsType.HIGHLIGHT_THICKNESS, _HighlightEditor._defaultThickness]];
  }
  get propertiesToUpdate() {
    return [[AnnotationEditorParamsType.HIGHLIGHT_COLOR, this.color || _HighlightEditor._defaultColor], [AnnotationEditorParamsType.HIGHLIGHT_THICKNESS, this.#thickness || _HighlightEditor._defaultThickness], [AnnotationEditorParamsType.HIGHLIGHT_FREE, this.#isFreeHighlight]];
  }
  #updateColor(color) {
    const setColorAndOpacity = (col, opa) => {
      this.color = col;
      this.#opacity = opa;
      this.parent?.drawLayer.updateProperties(this.#id, {
        root: {
          fill: col,
          "fill-opacity": opa
        }
      });
      this.#colorPicker?.updateColor(col);
    };
    const savedColor = this.color;
    const savedOpacity = this.#opacity;
    this.addCommands({
      cmd: setColorAndOpacity.bind(this, color, _HighlightEditor._defaultOpacity),
      undo: setColorAndOpacity.bind(this, savedColor, savedOpacity),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      overwriteIfSameType: true,
      keepUndo: true
    });
    this._reportTelemetry({
      action: "color_changed",
      color: this._uiManager.highlightColorNames.get(color)
    }, true);
  }
  #updateThickness(thickness) {
    const savedThickness = this.#thickness;
    const setThickness = (th) => {
      this.#thickness = th;
      this.#changeThickness(th);
    };
    this.addCommands({
      cmd: setThickness.bind(this, thickness),
      undo: setThickness.bind(this, savedThickness),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.INK_THICKNESS,
      overwriteIfSameType: true,
      keepUndo: true
    });
    this._reportTelemetry({
      action: "thickness_changed",
      thickness
    }, true);
  }
  async addEditToolbar() {
    const toolbar = await super.addEditToolbar();
    if (!toolbar) {
      return null;
    }
    if (this._uiManager.highlightColors) {
      this.#colorPicker = new ColorPicker({
        editor: this
      });
      toolbar.addColorPicker(this.#colorPicker);
    }
    return toolbar;
  }
  disableEditing() {
    super.disableEditing();
    this.div.classList.toggle("disabled", true);
  }
  enableEditing() {
    super.enableEditing();
    this.div.classList.toggle("disabled", false);
  }
  fixAndSetPosition() {
    return super.fixAndSetPosition(this.#getRotation());
  }
  getBaseTranslation() {
    return [0, 0];
  }
  getRect(tx, ty) {
    return super.getRect(tx, ty, this.#getRotation());
  }
  onceAdded(focus) {
    if (!this.annotationElementId) {
      this.parent.addUndoableEditor(this);
    }
    if (focus) {
      this.div.focus();
    }
  }
  remove() {
    this.#cleanDrawLayer();
    this._reportTelemetry({
      action: "deleted"
    });
    super.remove();
  }
  rebuild() {
    if (!this.parent) {
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }
    this.#addToDrawLayer();
    if (!this.isAttachedToDOM) {
      this.parent.add(this);
    }
  }
  setParent(parent) {
    let mustBeSelected = false;
    if (this.parent && !parent) {
      this.#cleanDrawLayer();
    } else if (parent) {
      this.#addToDrawLayer(parent);
      mustBeSelected = !this.parent && this.div?.classList.contains("selectedEditor");
    }
    super.setParent(parent);
    this.show(this._isVisible);
    if (mustBeSelected) {
      this.select();
    }
  }
  #changeThickness(thickness) {
    if (!this.#isFreeHighlight) {
      return;
    }
    this.#createFreeOutlines({
      highlightOutlines: this.#highlightOutlines.getNewOutline(thickness / 2)
    });
    this.fixAndSetPosition();
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(this.width * parentWidth, this.height * parentHeight);
  }
  #cleanDrawLayer() {
    if (this.#id === null || !this.parent) {
      return;
    }
    this.parent.drawLayer.remove(this.#id);
    this.#id = null;
    this.parent.drawLayer.remove(this.#outlineId);
    this.#outlineId = null;
  }
  #addToDrawLayer(parent = this.parent) {
    if (this.#id !== null) {
      return;
    }
    ({
      id: this.#id,
      clipPathId: this.#clipPathId
    } = parent.drawLayer.draw({
      bbox: this.#highlightOutlines.box,
      root: {
        viewBox: "0 0 1 1",
        fill: this.color,
        "fill-opacity": this.#opacity
      },
      rootClass: {
        highlight: true,
        free: this.#isFreeHighlight
      },
      path: {
        d: this.#highlightOutlines.toSVGPath()
      }
    }, false, true));
    this.#outlineId = parent.drawLayer.drawOutline({
      rootClass: {
        highlightOutline: true,
        free: this.#isFreeHighlight
      },
      bbox: this.#focusOutlines.box,
      path: {
        d: this.#focusOutlines.toSVGPath()
      }
    }, this.#isFreeHighlight);
    if (this.#highlightDiv) {
      this.#highlightDiv.style.clipPath = this.#clipPathId;
    }
  }
  static #rotateBbox([x, y, width, height], angle) {
    switch (angle) {
      case 90:
        return [1 - y - height, x, height, width];
      case 180:
        return [1 - x - width, 1 - y - height, width, height];
      case 270:
        return [y, 1 - x - width, height, width];
    }
    return [x, y, width, height];
  }
  rotate(angle) {
    const {
      drawLayer
    } = this.parent;
    let box;
    if (this.#isFreeHighlight) {
      angle = (angle - this.rotation + 360) % 360;
      box = _HighlightEditor.#rotateBbox(this.#highlightOutlines.box, angle);
    } else {
      box = _HighlightEditor.#rotateBbox([this.x, this.y, this.width, this.height], angle);
    }
    drawLayer.updateProperties(this.#id, {
      bbox: box,
      root: {
        "data-main-rotation": angle
      }
    });
    drawLayer.updateProperties(this.#outlineId, {
      bbox: _HighlightEditor.#rotateBbox(this.#focusOutlines.box, angle),
      root: {
        "data-main-rotation": angle
      }
    });
  }
  render() {
    if (this.div) {
      return this.div;
    }
    const div = super.render();
    if (this.#text) {
      div.setAttribute("aria-label", this.#text);
      div.setAttribute("role", "mark");
    }
    if (this.#isFreeHighlight) {
      div.classList.add("free");
    } else {
      this.div.addEventListener("keydown", this.#keydown.bind(this), {
        signal: this._uiManager._signal
      });
    }
    const highlightDiv = this.#highlightDiv = document.createElement("div");
    div.append(highlightDiv);
    highlightDiv.setAttribute("aria-hidden", "true");
    highlightDiv.className = "internal";
    highlightDiv.style.clipPath = this.#clipPathId;
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(this.width * parentWidth, this.height * parentHeight);
    bindEvents(this, this.#highlightDiv, ["pointerover", "pointerleave"]);
    this.enableEditing();
    return div;
  }
  pointerover() {
    if (!this.isSelected) {
      this.parent?.drawLayer.updateProperties(this.#outlineId, {
        rootClass: {
          hovered: true
        }
      });
    }
  }
  pointerleave() {
    if (!this.isSelected) {
      this.parent?.drawLayer.updateProperties(this.#outlineId, {
        rootClass: {
          hovered: false
        }
      });
    }
  }
  #keydown(event) {
    _HighlightEditor._keyboardManager.exec(this, event);
  }
  _moveCaret(direction) {
    this.parent.unselect(this);
    switch (direction) {
      case 0:
      case 2:
        this.#setCaret(true);
        break;
      case 1:
      case 3:
        this.#setCaret(false);
        break;
    }
  }
  #setCaret(start) {
    if (!this.#anchorNode) {
      return;
    }
    const selection = window.getSelection();
    if (start) {
      selection.setPosition(this.#anchorNode, this.#anchorOffset);
    } else {
      selection.setPosition(this.#focusNode, this.#focusOffset);
    }
  }
  select() {
    super.select();
    if (!this.#outlineId) {
      return;
    }
    this.parent?.drawLayer.updateProperties(this.#outlineId, {
      rootClass: {
        hovered: false,
        selected: true
      }
    });
  }
  unselect() {
    super.unselect();
    if (!this.#outlineId) {
      return;
    }
    this.parent?.drawLayer.updateProperties(this.#outlineId, {
      rootClass: {
        selected: false
      }
    });
    if (!this.#isFreeHighlight) {
      this.#setCaret(false);
    }
  }
  get _mustFixPosition() {
    return !this.#isFreeHighlight;
  }
  show(visible = this._isVisible) {
    super.show(visible);
    if (this.parent) {
      this.parent.drawLayer.updateProperties(this.#id, {
        rootClass: {
          hidden: !visible
        }
      });
      this.parent.drawLayer.updateProperties(this.#outlineId, {
        rootClass: {
          hidden: !visible
        }
      });
    }
  }
  #getRotation() {
    return this.#isFreeHighlight ? this.rotation : 0;
  }
  #serializeBoxes() {
    if (this.#isFreeHighlight) {
      return null;
    }
    const [pageWidth, pageHeight] = this.pageDimensions;
    const [pageX, pageY] = this.pageTranslation;
    const boxes = this.#boxes;
    const quadPoints = new Float32Array(boxes.length * 8);
    let i = 0;
    for (const {
      x,
      y,
      width,
      height
    } of boxes) {
      const sx = x * pageWidth + pageX;
      const sy = (1 - y) * pageHeight + pageY;
      quadPoints[i] = quadPoints[i + 4] = sx;
      quadPoints[i + 1] = quadPoints[i + 3] = sy;
      quadPoints[i + 2] = quadPoints[i + 6] = sx + width * pageWidth;
      quadPoints[i + 5] = quadPoints[i + 7] = sy - height * pageHeight;
      i += 8;
    }
    return quadPoints;
  }
  #serializeOutlines(rect) {
    return this.#highlightOutlines.serialize(rect, this.#getRotation());
  }
  static startHighlighting(parent, isLTR, {
    target: textLayer,
    x,
    y
  }) {
    const {
      x: layerX,
      y: layerY,
      width: parentWidth,
      height: parentHeight
    } = textLayer.getBoundingClientRect();
    const ac = new AbortController();
    const signal = parent.combinedSignal(ac);
    const pointerUpCallback = (e) => {
      ac.abort();
      this.#endHighlight(parent, e);
    };
    window.addEventListener("blur", pointerUpCallback, {
      signal
    });
    window.addEventListener("pointerup", pointerUpCallback, {
      signal
    });
    window.addEventListener("pointerdown", stopEvent, {
      capture: true,
      passive: false,
      signal
    });
    window.addEventListener("contextmenu", noContextMenu, {
      signal
    });
    textLayer.addEventListener("pointermove", this.#highlightMove.bind(this, parent), {
      signal
    });
    this._freeHighlight = new FreeHighlightOutliner({
      x,
      y
    }, [layerX, layerY, parentWidth, parentHeight], parent.scale, this._defaultThickness / 2, isLTR, 1e-3);
    ({
      id: this._freeHighlightId,
      clipPathId: this._freeHighlightClipId
    } = parent.drawLayer.draw({
      bbox: [0, 0, 1, 1],
      root: {
        viewBox: "0 0 1 1",
        fill: this._defaultColor,
        "fill-opacity": this._defaultOpacity
      },
      rootClass: {
        highlight: true,
        free: true
      },
      path: {
        d: this._freeHighlight.toSVGPath()
      }
    }, true, true));
  }
  static #highlightMove(parent, event) {
    if (this._freeHighlight.add(event)) {
      parent.drawLayer.updateProperties(this._freeHighlightId, {
        path: {
          d: this._freeHighlight.toSVGPath()
        }
      });
    }
  }
  static #endHighlight(parent, event) {
    if (!this._freeHighlight.isEmpty()) {
      parent.createAndAddNewEditor(event, false, {
        highlightId: this._freeHighlightId,
        highlightOutlines: this._freeHighlight.getOutlines(),
        clipPathId: this._freeHighlightClipId,
        methodOfCreation: "main_toolbar"
      });
    } else {
      parent.drawLayer.remove(this._freeHighlightId);
    }
    this._freeHighlightId = -1;
    this._freeHighlight = null;
    this._freeHighlightClipId = "";
  }
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    if (data instanceof HighlightAnnotationElement) {
      const {
        data: {
          quadPoints: quadPoints2,
          rect,
          rotation,
          id,
          color: color2,
          opacity: opacity2,
          popupRef
        },
        parent: {
          page: {
            pageNumber
          }
        }
      } = data;
      initialData = data = {
        annotationType: AnnotationEditorType.HIGHLIGHT,
        color: Array.from(color2),
        opacity: opacity2,
        quadPoints: quadPoints2,
        boxes: null,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        id,
        deleted: false,
        popupRef
      };
    } else if (data instanceof InkAnnotationElement) {
      const {
        data: {
          inkLists: inkLists2,
          rect,
          rotation,
          id,
          color: color2,
          borderStyle: {
            rawWidth: thickness
          },
          popupRef
        },
        parent: {
          page: {
            pageNumber
          }
        }
      } = data;
      initialData = data = {
        annotationType: AnnotationEditorType.HIGHLIGHT,
        color: Array.from(color2),
        thickness,
        inkLists: inkLists2,
        boxes: null,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        id,
        deleted: false,
        popupRef
      };
    }
    const {
      color,
      quadPoints,
      inkLists,
      opacity
    } = data;
    const editor = await super.deserialize(data, parent, uiManager);
    editor.color = Util.makeHexColor(...color);
    editor.#opacity = opacity || 1;
    if (inkLists) {
      editor.#thickness = data.thickness;
    }
    editor.annotationElementId = data.id || null;
    editor._initialData = initialData;
    const [pageWidth, pageHeight] = editor.pageDimensions;
    const [pageX, pageY] = editor.pageTranslation;
    if (quadPoints) {
      const boxes = editor.#boxes = [];
      for (let i = 0; i < quadPoints.length; i += 8) {
        boxes.push({
          x: (quadPoints[i] - pageX) / pageWidth,
          y: 1 - (quadPoints[i + 1] - pageY) / pageHeight,
          width: (quadPoints[i + 2] - quadPoints[i]) / pageWidth,
          height: (quadPoints[i + 1] - quadPoints[i + 5]) / pageHeight
        });
      }
      editor.#createOutlines();
      editor.#addToDrawLayer();
      editor.rotate(editor.rotation);
    } else if (inkLists) {
      editor.#isFreeHighlight = true;
      const points = inkLists[0];
      const point = {
        x: points[0] - pageX,
        y: pageHeight - (points[1] - pageY)
      };
      const outliner = new FreeHighlightOutliner(point, [0, 0, pageWidth, pageHeight], 1, editor.#thickness / 2, true, 1e-3);
      for (let i = 0, ii = points.length; i < ii; i += 2) {
        point.x = points[i] - pageX;
        point.y = pageHeight - (points[i + 1] - pageY);
        outliner.add(point);
      }
      const {
        id,
        clipPathId
      } = parent.drawLayer.draw({
        bbox: [0, 0, 1, 1],
        root: {
          viewBox: "0 0 1 1",
          fill: editor.color,
          "fill-opacity": editor._defaultOpacity
        },
        rootClass: {
          highlight: true,
          free: true
        },
        path: {
          d: outliner.toSVGPath()
        }
      }, true, true);
      editor.#createFreeOutlines({
        highlightOutlines: outliner.getOutlines(),
        highlightId: id,
        clipPathId
      });
      editor.#addToDrawLayer();
    }
    return editor;
  }
  serialize(isForCopying = false) {
    if (this.isEmpty() || isForCopying) {
      return null;
    }
    if (this.deleted) {
      return this.serializeDeleted();
    }
    const rect = this.getRect(0, 0);
    const color = AnnotationEditor._colorManager.convert(this.color);
    const serialized = {
      annotationType: AnnotationEditorType.HIGHLIGHT,
      color,
      opacity: this.#opacity,
      thickness: this.#thickness,
      quadPoints: this.#serializeBoxes(),
      outlines: this.#serializeOutlines(rect),
      pageIndex: this.pageIndex,
      rect,
      rotation: this.#getRotation(),
      structTreeParentId: this._structTreeParentId
    };
    if (this.annotationElementId && !this.#hasElementChanged(serialized)) {
      return null;
    }
    serialized.id = this.annotationElementId;
    return serialized;
  }
  #hasElementChanged(serialized) {
    const {
      color
    } = this._initialData;
    return serialized.color.some((c, i) => c !== color[i]);
  }
  renderAnnotationElement(annotation) {
    annotation.updateEdited({
      rect: this.getRect(0, 0)
    });
    return null;
  }
  static canCreateNewEmptyEditor() {
    return false;
  }
};
var DrawingOptions = class {
  #svgProperties = /* @__PURE__ */ Object.create(null);
  updateProperty(name, value) {
    this[name] = value;
    this.updateSVGProperty(name, value);
  }
  updateProperties(properties) {
    if (!properties) {
      return;
    }
    for (const [name, value] of Object.entries(properties)) {
      this.updateProperty(name, value);
    }
  }
  updateSVGProperty(name, value) {
    this.#svgProperties[name] = value;
  }
  toSVGProperties() {
    const root = this.#svgProperties;
    this.#svgProperties = /* @__PURE__ */ Object.create(null);
    return {
      root
    };
  }
  reset() {
    this.#svgProperties = /* @__PURE__ */ Object.create(null);
  }
  updateAll(options = this) {
    this.updateProperties(options);
  }
  clone() {
    unreachable("Not implemented");
  }
};
var DrawingEditor = class _DrawingEditor extends AnnotationEditor {
  #drawOutlines = null;
  #mustBeCommitted;
  _drawId = null;
  static _currentDrawId = -1;
  static _currentParent = null;
  static #currentDraw = null;
  static #currentDrawingAC = null;
  static #currentDrawingOptions = null;
  static #currentPointerId = NaN;
  static #currentPointerType = null;
  static #currentPointerIds = null;
  static #currentMoveTimestamp = NaN;
  static _INNER_MARGIN = 3;
  constructor(params) {
    super(params);
    this.#mustBeCommitted = params.mustBeCommitted || false;
    if (params.drawOutlines) {
      this.#createDrawOutlines(params);
      this.#addToDrawLayer();
    }
  }
  #createDrawOutlines({
    drawOutlines,
    drawId,
    drawingOptions
  }) {
    this.#drawOutlines = drawOutlines;
    this._drawingOptions ||= drawingOptions;
    if (drawId >= 0) {
      this._drawId = drawId;
      this.parent.drawLayer.finalizeDraw(drawId, drawOutlines.defaultProperties);
    } else {
      this._drawId = this.#createDrawing(drawOutlines, this.parent);
    }
    this.#updateBbox(drawOutlines.box);
  }
  #createDrawing(drawOutlines, parent) {
    const {
      id
    } = parent.drawLayer.draw(_DrawingEditor._mergeSVGProperties(this._drawingOptions.toSVGProperties(), drawOutlines.defaultSVGProperties), false, false);
    return id;
  }
  static _mergeSVGProperties(p1, p2) {
    const p1Keys = new Set(Object.keys(p1));
    for (const [key, value] of Object.entries(p2)) {
      if (p1Keys.has(key)) {
        Object.assign(p1[key], value);
      } else {
        p1[key] = value;
      }
    }
    return p1;
  }
  static getDefaultDrawingOptions(_options) {
    unreachable("Not implemented");
  }
  static get typesMap() {
    unreachable("Not implemented");
  }
  static get isDrawer() {
    return true;
  }
  static get supportMultipleDrawings() {
    return false;
  }
  static updateDefaultParams(type, value) {
    const propertyName = this.typesMap.get(type);
    if (propertyName) {
      this._defaultDrawingOptions.updateProperty(propertyName, value);
    }
    if (this._currentParent) {
      _DrawingEditor.#currentDraw.updateProperty(propertyName, value);
      this._currentParent.drawLayer.updateProperties(this._currentDrawId, this._defaultDrawingOptions.toSVGProperties());
    }
  }
  updateParams(type, value) {
    const propertyName = this.constructor.typesMap.get(type);
    if (propertyName) {
      this._updateProperty(type, propertyName, value);
    }
  }
  static get defaultPropertiesToUpdate() {
    const properties = [];
    const options = this._defaultDrawingOptions;
    for (const [type, name] of this.typesMap) {
      properties.push([type, options[name]]);
    }
    return properties;
  }
  get propertiesToUpdate() {
    const properties = [];
    const {
      _drawingOptions
    } = this;
    for (const [type, name] of this.constructor.typesMap) {
      properties.push([type, _drawingOptions[name]]);
    }
    return properties;
  }
  _updateProperty(type, name, value) {
    const options = this._drawingOptions;
    const savedValue = options[name];
    const setter = (val) => {
      options.updateProperty(name, val);
      const bbox = this.#drawOutlines.updateProperty(name, val);
      if (bbox) {
        this.#updateBbox(bbox);
      }
      this.parent?.drawLayer.updateProperties(this._drawId, options.toSVGProperties());
    };
    this.addCommands({
      cmd: setter.bind(this, value),
      undo: setter.bind(this, savedValue),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type,
      overwriteIfSameType: true,
      keepUndo: true
    });
  }
  _onResizing() {
    this.parent?.drawLayer.updateProperties(this._drawId, _DrawingEditor._mergeSVGProperties(this.#drawOutlines.getPathResizingSVGProperties(this.#convertToDrawSpace()), {
      bbox: this.#rotateBox()
    }));
  }
  _onResized() {
    this.parent?.drawLayer.updateProperties(this._drawId, _DrawingEditor._mergeSVGProperties(this.#drawOutlines.getPathResizedSVGProperties(this.#convertToDrawSpace()), {
      bbox: this.#rotateBox()
    }));
  }
  _onTranslating(x, y) {
    this.parent?.drawLayer.updateProperties(this._drawId, {
      bbox: this.#rotateBox(x, y)
    });
  }
  _onTranslated() {
    this.parent?.drawLayer.updateProperties(this._drawId, _DrawingEditor._mergeSVGProperties(this.#drawOutlines.getPathTranslatedSVGProperties(this.#convertToDrawSpace(), this.parentDimensions), {
      bbox: this.#rotateBox()
    }));
  }
  _onStartDragging() {
    this.parent?.drawLayer.updateProperties(this._drawId, {
      rootClass: {
        moving: true
      }
    });
  }
  _onStopDragging() {
    this.parent?.drawLayer.updateProperties(this._drawId, {
      rootClass: {
        moving: false
      }
    });
  }
  commit() {
    super.commit();
    this.disableEditMode();
    this.disableEditing();
  }
  disableEditing() {
    super.disableEditing();
    this.div.classList.toggle("disabled", true);
  }
  enableEditing() {
    super.enableEditing();
    this.div.classList.toggle("disabled", false);
  }
  getBaseTranslation() {
    return [0, 0];
  }
  get isResizable() {
    return true;
  }
  onceAdded(focus) {
    if (!this.annotationElementId) {
      this.parent.addUndoableEditor(this);
    }
    this._isDraggable = true;
    if (this.#mustBeCommitted) {
      this.#mustBeCommitted = false;
      this.commit();
      this.parent.setSelected(this);
      if (focus && this.isOnScreen) {
        this.div.focus();
      }
    }
  }
  remove() {
    this.#cleanDrawLayer();
    super.remove();
  }
  rebuild() {
    if (!this.parent) {
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }
    this.#addToDrawLayer();
    this.#updateBbox(this.#drawOutlines.box);
    if (!this.isAttachedToDOM) {
      this.parent.add(this);
    }
  }
  setParent(parent) {
    let mustBeSelected = false;
    if (this.parent && !parent) {
      this._uiManager.removeShouldRescale(this);
      this.#cleanDrawLayer();
    } else if (parent) {
      this._uiManager.addShouldRescale(this);
      this.#addToDrawLayer(parent);
      mustBeSelected = !this.parent && this.div?.classList.contains("selectedEditor");
    }
    super.setParent(parent);
    if (mustBeSelected) {
      this.select();
    }
  }
  #cleanDrawLayer() {
    if (this._drawId === null || !this.parent) {
      return;
    }
    this.parent.drawLayer.remove(this._drawId);
    this._drawId = null;
    this._drawingOptions.reset();
  }
  #addToDrawLayer(parent = this.parent) {
    if (this._drawId !== null && this.parent === parent) {
      return;
    }
    if (this._drawId !== null) {
      this.parent.drawLayer.updateParent(this._drawId, parent.drawLayer);
      return;
    }
    this._drawingOptions.updateAll();
    this._drawId = this.#createDrawing(this.#drawOutlines, parent);
  }
  #convertToParentSpace([x, y, width, height]) {
    const {
      parentDimensions: [pW, pH],
      rotation
    } = this;
    switch (rotation) {
      case 90:
        return [y, 1 - x, width * (pH / pW), height * (pW / pH)];
      case 180:
        return [1 - x, 1 - y, width, height];
      case 270:
        return [1 - y, x, width * (pH / pW), height * (pW / pH)];
      default:
        return [x, y, width, height];
    }
  }
  #convertToDrawSpace() {
    const {
      x,
      y,
      width,
      height,
      parentDimensions: [pW, pH],
      rotation
    } = this;
    switch (rotation) {
      case 90:
        return [1 - y, x, width * (pW / pH), height * (pH / pW)];
      case 180:
        return [1 - x, 1 - y, width, height];
      case 270:
        return [y, 1 - x, width * (pW / pH), height * (pH / pW)];
      default:
        return [x, y, width, height];
    }
  }
  #updateBbox(bbox) {
    [this.x, this.y, this.width, this.height] = this.#convertToParentSpace(bbox);
    if (this.div) {
      this.fixAndSetPosition();
      const [parentWidth, parentHeight] = this.parentDimensions;
      this.setDims(this.width * parentWidth, this.height * parentHeight);
    }
    this._onResized();
  }
  #rotateBox() {
    const {
      x,
      y,
      width,
      height,
      rotation,
      parentRotation,
      parentDimensions: [pW, pH]
    } = this;
    switch ((rotation * 4 + parentRotation) / 90) {
      case 1:
        return [1 - y - height, x, height, width];
      case 2:
        return [1 - x - width, 1 - y - height, width, height];
      case 3:
        return [y, 1 - x - width, height, width];
      case 4:
        return [x, y - width * (pW / pH), height * (pH / pW), width * (pW / pH)];
      case 5:
        return [1 - y, x, width * (pW / pH), height * (pH / pW)];
      case 6:
        return [1 - x - height * (pH / pW), 1 - y, height * (pH / pW), width * (pW / pH)];
      case 7:
        return [y - width * (pW / pH), 1 - x - height * (pH / pW), width * (pW / pH), height * (pH / pW)];
      case 8:
        return [x - width, y - height, width, height];
      case 9:
        return [1 - y, x - width, height, width];
      case 10:
        return [1 - x, 1 - y, width, height];
      case 11:
        return [y - height, 1 - x, height, width];
      case 12:
        return [x - height * (pH / pW), y, height * (pH / pW), width * (pW / pH)];
      case 13:
        return [1 - y - width * (pW / pH), x - height * (pH / pW), width * (pW / pH), height * (pH / pW)];
      case 14:
        return [1 - x, 1 - y - width * (pW / pH), height * (pH / pW), width * (pW / pH)];
      case 15:
        return [y, 1 - x, width * (pW / pH), height * (pH / pW)];
      default:
        return [x, y, width, height];
    }
  }
  rotate() {
    if (!this.parent) {
      return;
    }
    this.parent.drawLayer.updateProperties(this._drawId, _DrawingEditor._mergeSVGProperties({
      bbox: this.#rotateBox()
    }, this.#drawOutlines.updateRotation((this.parentRotation - this.rotation + 360) % 360)));
  }
  onScaleChanging() {
    if (!this.parent) {
      return;
    }
    this.#updateBbox(this.#drawOutlines.updateParentDimensions(this.parentDimensions, this.parent.scale));
  }
  static onScaleChangingWhenDrawing() {
  }
  render() {
    if (this.div) {
      return this.div;
    }
    const div = super.render();
    div.classList.add("draw");
    const drawDiv = document.createElement("div");
    div.append(drawDiv);
    drawDiv.setAttribute("aria-hidden", "true");
    drawDiv.className = "internal";
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(this.width * parentWidth, this.height * parentHeight);
    this._uiManager.addShouldRescale(this);
    this.disableEditing();
    return div;
  }
  static createDrawerInstance(_x, _y, _parentWidth, _parentHeight, _rotation) {
    unreachable("Not implemented");
  }
  static startDrawing(parent, uiManager, _isLTR, event) {
    const {
      target,
      offsetX: x,
      offsetY: y,
      pointerId,
      pointerType
    } = event;
    if (_DrawingEditor.#currentPointerType && _DrawingEditor.#currentPointerType !== pointerType) {
      return;
    }
    const {
      viewport: {
        rotation
      }
    } = parent;
    const {
      width: parentWidth,
      height: parentHeight
    } = target.getBoundingClientRect();
    const ac = _DrawingEditor.#currentDrawingAC = new AbortController();
    const signal = parent.combinedSignal(ac);
    _DrawingEditor.#currentPointerId ||= pointerId;
    _DrawingEditor.#currentPointerType ??= pointerType;
    window.addEventListener("pointerup", (e) => {
      if (_DrawingEditor.#currentPointerId === e.pointerId) {
        this._endDraw(e);
      } else {
        _DrawingEditor.#currentPointerIds?.delete(e.pointerId);
      }
    }, {
      signal
    });
    window.addEventListener("pointercancel", (e) => {
      if (_DrawingEditor.#currentPointerId === e.pointerId) {
        this._currentParent.endDrawingSession();
      } else {
        _DrawingEditor.#currentPointerIds?.delete(e.pointerId);
      }
    }, {
      signal
    });
    window.addEventListener("pointerdown", (e) => {
      if (_DrawingEditor.#currentPointerType !== e.pointerType) {
        return;
      }
      (_DrawingEditor.#currentPointerIds ||= /* @__PURE__ */ new Set()).add(e.pointerId);
      if (_DrawingEditor.#currentDraw.isCancellable()) {
        _DrawingEditor.#currentDraw.removeLastElement();
        if (_DrawingEditor.#currentDraw.isEmpty()) {
          this._currentParent.endDrawingSession(true);
        } else {
          this._endDraw(null);
        }
      }
    }, {
      capture: true,
      passive: false,
      signal
    });
    window.addEventListener("contextmenu", noContextMenu, {
      signal
    });
    target.addEventListener("pointermove", this._drawMove.bind(this), {
      signal
    });
    target.addEventListener("touchmove", (e) => {
      if (e.timeStamp === _DrawingEditor.#currentMoveTimestamp) {
        stopEvent(e);
      }
    }, {
      signal
    });
    parent.toggleDrawing();
    uiManager._editorUndoBar?.hide();
    if (_DrawingEditor.#currentDraw) {
      parent.drawLayer.updateProperties(this._currentDrawId, _DrawingEditor.#currentDraw.startNew(x, y, parentWidth, parentHeight, rotation));
      return;
    }
    uiManager.updateUIForDefaultProperties(this);
    _DrawingEditor.#currentDraw = this.createDrawerInstance(x, y, parentWidth, parentHeight, rotation);
    _DrawingEditor.#currentDrawingOptions = this.getDefaultDrawingOptions();
    this._currentParent = parent;
    ({
      id: this._currentDrawId
    } = parent.drawLayer.draw(this._mergeSVGProperties(_DrawingEditor.#currentDrawingOptions.toSVGProperties(), _DrawingEditor.#currentDraw.defaultSVGProperties), true, false));
  }
  static _drawMove(event) {
    _DrawingEditor.#currentMoveTimestamp = -1;
    if (!_DrawingEditor.#currentDraw) {
      return;
    }
    const {
      offsetX,
      offsetY,
      pointerId
    } = event;
    if (_DrawingEditor.#currentPointerId !== pointerId) {
      return;
    }
    if (_DrawingEditor.#currentPointerIds?.size >= 1) {
      this._endDraw(event);
      return;
    }
    this._currentParent.drawLayer.updateProperties(this._currentDrawId, _DrawingEditor.#currentDraw.add(offsetX, offsetY));
    _DrawingEditor.#currentMoveTimestamp = event.timeStamp;
    stopEvent(event);
  }
  static _cleanup(all) {
    if (all) {
      this._currentDrawId = -1;
      this._currentParent = null;
      _DrawingEditor.#currentDraw = null;
      _DrawingEditor.#currentDrawingOptions = null;
      _DrawingEditor.#currentPointerType = null;
      _DrawingEditor.#currentMoveTimestamp = NaN;
    }
    if (_DrawingEditor.#currentDrawingAC) {
      _DrawingEditor.#currentDrawingAC.abort();
      _DrawingEditor.#currentDrawingAC = null;
      _DrawingEditor.#currentPointerId = NaN;
      _DrawingEditor.#currentPointerIds = null;
    }
  }
  static _endDraw(event) {
    const parent = this._currentParent;
    if (!parent) {
      return;
    }
    parent.toggleDrawing(true);
    this._cleanup(false);
    if (event) {
      parent.drawLayer.updateProperties(this._currentDrawId, _DrawingEditor.#currentDraw.end(event.offsetX, event.offsetY));
    }
    if (this.supportMultipleDrawings) {
      const draw = _DrawingEditor.#currentDraw;
      const drawId = this._currentDrawId;
      const lastElement = draw.getLastElement();
      parent.addCommands({
        cmd: () => {
          parent.drawLayer.updateProperties(drawId, draw.setLastElement(lastElement));
        },
        undo: () => {
          parent.drawLayer.updateProperties(drawId, draw.removeLastElement());
        },
        mustExec: false,
        type: AnnotationEditorParamsType.DRAW_STEP
      });
      return;
    }
    this.endDrawing(false);
  }
  static endDrawing(isAborted) {
    const parent = this._currentParent;
    if (!parent) {
      return null;
    }
    parent.toggleDrawing(true);
    parent.cleanUndoStack(AnnotationEditorParamsType.DRAW_STEP);
    if (!_DrawingEditor.#currentDraw.isEmpty()) {
      const {
        pageDimensions: [pageWidth, pageHeight],
        scale
      } = parent;
      const editor = parent.createAndAddNewEditor({
        offsetX: 0,
        offsetY: 0
      }, false, {
        drawId: this._currentDrawId,
        drawOutlines: _DrawingEditor.#currentDraw.getOutlines(pageWidth * scale, pageHeight * scale, scale, this._INNER_MARGIN),
        drawingOptions: _DrawingEditor.#currentDrawingOptions,
        mustBeCommitted: !isAborted
      });
      this._cleanup(true);
      return editor;
    }
    parent.drawLayer.remove(this._currentDrawId);
    this._cleanup(true);
    return null;
  }
  createDrawingOptions(_data) {
  }
  static deserializeDraw(_pageX, _pageY, _pageWidth, _pageHeight, _innerWidth, _data) {
    unreachable("Not implemented");
  }
  static async deserialize(data, parent, uiManager) {
    const {
      rawDims: {
        pageWidth,
        pageHeight,
        pageX,
        pageY
      }
    } = parent.viewport;
    const drawOutlines = this.deserializeDraw(pageX, pageY, pageWidth, pageHeight, this._INNER_MARGIN, data);
    const editor = await super.deserialize(data, parent, uiManager);
    editor.createDrawingOptions(data);
    editor.#createDrawOutlines({
      drawOutlines
    });
    editor.#addToDrawLayer();
    editor.onScaleChanging();
    editor.rotate();
    return editor;
  }
  serializeDraw(isForCopying) {
    const [pageX, pageY] = this.pageTranslation;
    const [pageWidth, pageHeight] = this.pageDimensions;
    return this.#drawOutlines.serialize([pageX, pageY, pageWidth, pageHeight], isForCopying);
  }
  renderAnnotationElement(annotation) {
    annotation.updateEdited({
      rect: this.getRect(0, 0)
    });
    return null;
  }
  static canCreateNewEmptyEditor() {
    return false;
  }
};
var InkDrawOutliner = class {
  #last = new Float64Array(6);
  #line;
  #lines;
  #rotation;
  #thickness;
  #points;
  #lastSVGPath = "";
  #lastIndex = 0;
  #outlines = new InkDrawOutline();
  #parentWidth;
  #parentHeight;
  constructor(x, y, parentWidth, parentHeight, rotation, thickness) {
    this.#parentWidth = parentWidth;
    this.#parentHeight = parentHeight;
    this.#rotation = rotation;
    this.#thickness = thickness;
    [x, y] = this.#normalizePoint(x, y);
    const line = this.#line = [NaN, NaN, NaN, NaN, x, y];
    this.#points = [x, y];
    this.#lines = [{
      line,
      points: this.#points
    }];
    this.#last.set(line, 0);
  }
  updateProperty(name, value) {
    if (name === "stroke-width") {
      this.#thickness = value;
    }
  }
  #normalizePoint(x, y) {
    return Outline._normalizePoint(x, y, this.#parentWidth, this.#parentHeight, this.#rotation);
  }
  isEmpty() {
    return !this.#lines || this.#lines.length === 0;
  }
  isCancellable() {
    return this.#points.length <= 10;
  }
  add(x, y) {
    [x, y] = this.#normalizePoint(x, y);
    const [x1, y1, x2, y2] = this.#last.subarray(2, 6);
    const diffX = x - x2;
    const diffY = y - y2;
    const d = Math.hypot(this.#parentWidth * diffX, this.#parentHeight * diffY);
    if (d <= 2) {
      return null;
    }
    this.#points.push(x, y);
    if (isNaN(x1)) {
      this.#last.set([x2, y2, x, y], 2);
      this.#line.push(NaN, NaN, NaN, NaN, x, y);
      return {
        path: {
          d: this.toSVGPath()
        }
      };
    }
    if (isNaN(this.#last[0])) {
      this.#line.splice(6, 6);
    }
    this.#last.set([x1, y1, x2, y2, x, y], 0);
    this.#line.push(...Outline.createBezierPoints(x1, y1, x2, y2, x, y));
    return {
      path: {
        d: this.toSVGPath()
      }
    };
  }
  end(x, y) {
    const change = this.add(x, y);
    if (change) {
      return change;
    }
    if (this.#points.length === 2) {
      return {
        path: {
          d: this.toSVGPath()
        }
      };
    }
    return null;
  }
  startNew(x, y, parentWidth, parentHeight, rotation) {
    this.#parentWidth = parentWidth;
    this.#parentHeight = parentHeight;
    this.#rotation = rotation;
    [x, y] = this.#normalizePoint(x, y);
    const line = this.#line = [NaN, NaN, NaN, NaN, x, y];
    this.#points = [x, y];
    const last = this.#lines.at(-1);
    if (last) {
      last.line = new Float32Array(last.line);
      last.points = new Float32Array(last.points);
    }
    this.#lines.push({
      line,
      points: this.#points
    });
    this.#last.set(line, 0);
    this.#lastIndex = 0;
    this.toSVGPath();
    return null;
  }
  getLastElement() {
    return this.#lines.at(-1);
  }
  setLastElement(element) {
    if (!this.#lines) {
      return this.#outlines.setLastElement(element);
    }
    this.#lines.push(element);
    this.#line = element.line;
    this.#points = element.points;
    this.#lastIndex = 0;
    return {
      path: {
        d: this.toSVGPath()
      }
    };
  }
  removeLastElement() {
    if (!this.#lines) {
      return this.#outlines.removeLastElement();
    }
    this.#lines.pop();
    this.#lastSVGPath = "";
    for (let i = 0, ii = this.#lines.length; i < ii; i++) {
      const {
        line,
        points
      } = this.#lines[i];
      this.#line = line;
      this.#points = points;
      this.#lastIndex = 0;
      this.toSVGPath();
    }
    return {
      path: {
        d: this.#lastSVGPath
      }
    };
  }
  toSVGPath() {
    const firstX = Outline.svgRound(this.#line[4]);
    const firstY = Outline.svgRound(this.#line[5]);
    if (this.#points.length === 2) {
      this.#lastSVGPath = `${this.#lastSVGPath} M ${firstX} ${firstY} Z`;
      return this.#lastSVGPath;
    }
    if (this.#points.length <= 6) {
      const i = this.#lastSVGPath.lastIndexOf("M");
      this.#lastSVGPath = `${this.#lastSVGPath.slice(0, i)} M ${firstX} ${firstY}`;
      this.#lastIndex = 6;
    }
    if (this.#points.length === 4) {
      const secondX = Outline.svgRound(this.#line[10]);
      const secondY = Outline.svgRound(this.#line[11]);
      this.#lastSVGPath = `${this.#lastSVGPath} L ${secondX} ${secondY}`;
      this.#lastIndex = 12;
      return this.#lastSVGPath;
    }
    const buffer = [];
    if (this.#lastIndex === 0) {
      buffer.push(`M ${firstX} ${firstY}`);
      this.#lastIndex = 6;
    }
    for (let i = this.#lastIndex, ii = this.#line.length; i < ii; i += 6) {
      const [c1x, c1y, c2x, c2y, x, y] = this.#line.slice(i, i + 6).map(Outline.svgRound);
      buffer.push(`C${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`);
    }
    this.#lastSVGPath += buffer.join(" ");
    this.#lastIndex = this.#line.length;
    return this.#lastSVGPath;
  }
  getOutlines(parentWidth, parentHeight, scale, innerMargin) {
    const last = this.#lines.at(-1);
    last.line = new Float32Array(last.line);
    last.points = new Float32Array(last.points);
    this.#outlines.build(this.#lines, parentWidth, parentHeight, scale, this.#rotation, this.#thickness, innerMargin);
    this.#last = null;
    this.#line = null;
    this.#lines = null;
    this.#lastSVGPath = null;
    return this.#outlines;
  }
  get defaultSVGProperties() {
    return {
      root: {
        viewBox: "0 0 10000 10000"
      },
      rootClass: {
        draw: true
      },
      bbox: [0, 0, 1, 1]
    };
  }
};
var InkDrawOutline = class _InkDrawOutline extends Outline {
  #bbox;
  #currentRotation = 0;
  #innerMargin;
  #lines;
  #parentWidth;
  #parentHeight;
  #parentScale;
  #rotation;
  #thickness;
  build(lines, parentWidth, parentHeight, parentScale, rotation, thickness, innerMargin) {
    this.#parentWidth = parentWidth;
    this.#parentHeight = parentHeight;
    this.#parentScale = parentScale;
    this.#rotation = rotation;
    this.#thickness = thickness;
    this.#innerMargin = innerMargin ?? 0;
    this.#lines = lines;
    this.#computeBbox();
  }
  setLastElement(element) {
    this.#lines.push(element);
    return {
      path: {
        d: this.toSVGPath()
      }
    };
  }
  removeLastElement() {
    this.#lines.pop();
    return {
      path: {
        d: this.toSVGPath()
      }
    };
  }
  toSVGPath() {
    const buffer = [];
    for (const {
      line
    } of this.#lines) {
      buffer.push(`M${Outline.svgRound(line[4])} ${Outline.svgRound(line[5])}`);
      if (line.length === 6) {
        buffer.push("Z");
        continue;
      }
      if (line.length === 12) {
        buffer.push(`L${Outline.svgRound(line[10])} ${Outline.svgRound(line[11])}`);
        continue;
      }
      for (let i = 6, ii = line.length; i < ii; i += 6) {
        const [c1x, c1y, c2x, c2y, x, y] = line.subarray(i, i + 6).map(Outline.svgRound);
        buffer.push(`C${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`);
      }
    }
    return buffer.join("");
  }
  serialize([pageX, pageY, pageWidth, pageHeight], isForCopying) {
    const serializedLines = [];
    const serializedPoints = [];
    const [x, y, width, height] = this.#getBBoxWithNoMargin();
    let tx, ty, sx, sy, x1, y1, x2, y2, rescaleFn;
    switch (this.#rotation) {
      case 0:
        rescaleFn = Outline._rescale;
        tx = pageX;
        ty = pageY + pageHeight;
        sx = pageWidth;
        sy = -pageHeight;
        x1 = pageX + x * pageWidth;
        y1 = pageY + (1 - y - height) * pageHeight;
        x2 = pageX + (x + width) * pageWidth;
        y2 = pageY + (1 - y) * pageHeight;
        break;
      case 90:
        rescaleFn = Outline._rescaleAndSwap;
        tx = pageX;
        ty = pageY;
        sx = pageWidth;
        sy = pageHeight;
        x1 = pageX + y * pageWidth;
        y1 = pageY + x * pageHeight;
        x2 = pageX + (y + height) * pageWidth;
        y2 = pageY + (x + width) * pageHeight;
        break;
      case 180:
        rescaleFn = Outline._rescale;
        tx = pageX + pageWidth;
        ty = pageY;
        sx = -pageWidth;
        sy = pageHeight;
        x1 = pageX + (1 - x - width) * pageWidth;
        y1 = pageY + y * pageHeight;
        x2 = pageX + (1 - x) * pageWidth;
        y2 = pageY + (y + height) * pageHeight;
        break;
      case 270:
        rescaleFn = Outline._rescaleAndSwap;
        tx = pageX + pageWidth;
        ty = pageY + pageHeight;
        sx = -pageWidth;
        sy = -pageHeight;
        x1 = pageX + (1 - y - height) * pageWidth;
        y1 = pageY + (1 - x - width) * pageHeight;
        x2 = pageX + (1 - y) * pageWidth;
        y2 = pageY + (1 - x) * pageHeight;
        break;
    }
    for (const {
      line,
      points
    } of this.#lines) {
      serializedLines.push(rescaleFn(line, tx, ty, sx, sy, isForCopying ? new Array(line.length) : null));
      serializedPoints.push(rescaleFn(points, tx, ty, sx, sy, isForCopying ? new Array(points.length) : null));
    }
    return {
      lines: serializedLines,
      points: serializedPoints,
      rect: [x1, y1, x2, y2]
    };
  }
  static deserialize(pageX, pageY, pageWidth, pageHeight, innerMargin, {
    paths: {
      lines,
      points
    },
    rotation,
    thickness
  }) {
    const newLines = [];
    let tx, ty, sx, sy, rescaleFn;
    switch (rotation) {
      case 0:
        rescaleFn = Outline._rescale;
        tx = -pageX / pageWidth;
        ty = pageY / pageHeight + 1;
        sx = 1 / pageWidth;
        sy = -1 / pageHeight;
        break;
      case 90:
        rescaleFn = Outline._rescaleAndSwap;
        tx = -pageY / pageHeight;
        ty = -pageX / pageWidth;
        sx = 1 / pageHeight;
        sy = 1 / pageWidth;
        break;
      case 180:
        rescaleFn = Outline._rescale;
        tx = pageX / pageWidth + 1;
        ty = -pageY / pageHeight;
        sx = -1 / pageWidth;
        sy = 1 / pageHeight;
        break;
      case 270:
        rescaleFn = Outline._rescaleAndSwap;
        tx = pageY / pageHeight + 1;
        ty = pageX / pageWidth + 1;
        sx = -1 / pageHeight;
        sy = -1 / pageWidth;
        break;
    }
    if (!lines) {
      lines = [];
      for (const point of points) {
        const len = point.length;
        if (len === 2) {
          lines.push(new Float32Array([NaN, NaN, NaN, NaN, point[0], point[1]]));
          continue;
        }
        if (len === 4) {
          lines.push(new Float32Array([NaN, NaN, NaN, NaN, point[0], point[1], NaN, NaN, NaN, NaN, point[2], point[3]]));
          continue;
        }
        const line = new Float32Array(3 * (len - 2));
        lines.push(line);
        let [x1, y1, x2, y2] = point.subarray(0, 4);
        line.set([NaN, NaN, NaN, NaN, x1, y1], 0);
        for (let i = 4; i < len; i += 2) {
          const x = point[i];
          const y = point[i + 1];
          line.set(Outline.createBezierPoints(x1, y1, x2, y2, x, y), (i - 2) * 3);
          [x1, y1, x2, y2] = [x2, y2, x, y];
        }
      }
    }
    for (let i = 0, ii = lines.length; i < ii; i++) {
      newLines.push({
        line: rescaleFn(lines[i].map((x) => x ?? NaN), tx, ty, sx, sy),
        points: rescaleFn(points[i].map((x) => x ?? NaN), tx, ty, sx, sy)
      });
    }
    const outlines = new _InkDrawOutline();
    outlines.build(newLines, pageWidth, pageHeight, 1, rotation, thickness, innerMargin);
    return outlines;
  }
  #getMarginComponents(thickness = this.#thickness) {
    const margin = this.#innerMargin + thickness / 2 * this.#parentScale;
    return this.#rotation % 180 === 0 ? [margin / this.#parentWidth, margin / this.#parentHeight] : [margin / this.#parentHeight, margin / this.#parentWidth];
  }
  #getBBoxWithNoMargin() {
    const [x, y, width, height] = this.#bbox;
    const [marginX, marginY] = this.#getMarginComponents(0);
    return [x + marginX, y + marginY, width - 2 * marginX, height - 2 * marginY];
  }
  #computeBbox() {
    const bbox = this.#bbox = new Float32Array([Infinity, Infinity, -Infinity, -Infinity]);
    for (const {
      line
    } of this.#lines) {
      if (line.length <= 12) {
        for (let i = 4, ii = line.length; i < ii; i += 6) {
          const [x, y] = line.subarray(i, i + 2);
          bbox[0] = Math.min(bbox[0], x);
          bbox[1] = Math.min(bbox[1], y);
          bbox[2] = Math.max(bbox[2], x);
          bbox[3] = Math.max(bbox[3], y);
        }
        continue;
      }
      let lastX = line[4], lastY = line[5];
      for (let i = 6, ii = line.length; i < ii; i += 6) {
        const [c1x, c1y, c2x, c2y, x, y] = line.subarray(i, i + 6);
        Util.bezierBoundingBox(lastX, lastY, c1x, c1y, c2x, c2y, x, y, bbox);
        lastX = x;
        lastY = y;
      }
    }
    const [marginX, marginY] = this.#getMarginComponents();
    bbox[0] = Math.min(1, Math.max(0, bbox[0] - marginX));
    bbox[1] = Math.min(1, Math.max(0, bbox[1] - marginY));
    bbox[2] = Math.min(1, Math.max(0, bbox[2] + marginX));
    bbox[3] = Math.min(1, Math.max(0, bbox[3] + marginY));
    bbox[2] -= bbox[0];
    bbox[3] -= bbox[1];
  }
  get box() {
    return this.#bbox;
  }
  updateProperty(name, value) {
    if (name === "stroke-width") {
      return this.#updateThickness(value);
    }
    return null;
  }
  #updateThickness(thickness) {
    const [oldMarginX, oldMarginY] = this.#getMarginComponents();
    this.#thickness = thickness;
    const [newMarginX, newMarginY] = this.#getMarginComponents();
    const [diffMarginX, diffMarginY] = [newMarginX - oldMarginX, newMarginY - oldMarginY];
    const bbox = this.#bbox;
    bbox[0] -= diffMarginX;
    bbox[1] -= diffMarginY;
    bbox[2] += 2 * diffMarginX;
    bbox[3] += 2 * diffMarginY;
    return bbox;
  }
  updateParentDimensions([width, height], scale) {
    const [oldMarginX, oldMarginY] = this.#getMarginComponents();
    this.#parentWidth = width;
    this.#parentHeight = height;
    this.#parentScale = scale;
    const [newMarginX, newMarginY] = this.#getMarginComponents();
    const diffMarginX = newMarginX - oldMarginX;
    const diffMarginY = newMarginY - oldMarginY;
    const bbox = this.#bbox;
    bbox[0] -= diffMarginX;
    bbox[1] -= diffMarginY;
    bbox[2] += 2 * diffMarginX;
    bbox[3] += 2 * diffMarginY;
    return bbox;
  }
  updateRotation(rotation) {
    this.#currentRotation = rotation;
    return {
      path: {
        transform: this.rotationTransform
      }
    };
  }
  get viewBox() {
    return this.#bbox.map(Outline.svgRound).join(" ");
  }
  get defaultProperties() {
    const [x, y] = this.#bbox;
    return {
      root: {
        viewBox: this.viewBox
      },
      path: {
        "transform-origin": `${Outline.svgRound(x)} ${Outline.svgRound(y)}`
      }
    };
  }
  get rotationTransform() {
    const [, , width, height] = this.#bbox;
    let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0;
    switch (this.#currentRotation) {
      case 90:
        b = height / width;
        c = -width / height;
        e = width;
        break;
      case 180:
        a = -1;
        d = -1;
        e = width;
        f = height;
        break;
      case 270:
        b = -height / width;
        c = width / height;
        f = height;
        break;
      default:
        return "";
    }
    return `matrix(${a} ${b} ${c} ${d} ${Outline.svgRound(e)} ${Outline.svgRound(f)})`;
  }
  getPathResizingSVGProperties([newX, newY, newWidth, newHeight]) {
    const [marginX, marginY] = this.#getMarginComponents();
    const [x, y, width, height] = this.#bbox;
    if (Math.abs(width - marginX) <= Outline.PRECISION || Math.abs(height - marginY) <= Outline.PRECISION) {
      const tx = newX + newWidth / 2 - (x + width / 2);
      const ty = newY + newHeight / 2 - (y + height / 2);
      return {
        path: {
          "transform-origin": `${Outline.svgRound(newX)} ${Outline.svgRound(newY)}`,
          transform: `${this.rotationTransform} translate(${tx} ${ty})`
        }
      };
    }
    const s1x = (newWidth - 2 * marginX) / (width - 2 * marginX);
    const s1y = (newHeight - 2 * marginY) / (height - 2 * marginY);
    const s2x = width / newWidth;
    const s2y = height / newHeight;
    return {
      path: {
        "transform-origin": `${Outline.svgRound(x)} ${Outline.svgRound(y)}`,
        transform: `${this.rotationTransform} scale(${s2x} ${s2y}) translate(${Outline.svgRound(marginX)} ${Outline.svgRound(marginY)}) scale(${s1x} ${s1y}) translate(${Outline.svgRound(-marginX)} ${Outline.svgRound(-marginY)})`
      }
    };
  }
  getPathResizedSVGProperties([newX, newY, newWidth, newHeight]) {
    const [marginX, marginY] = this.#getMarginComponents();
    const bbox = this.#bbox;
    const [x, y, width, height] = bbox;
    bbox[0] = newX;
    bbox[1] = newY;
    bbox[2] = newWidth;
    bbox[3] = newHeight;
    if (Math.abs(width - marginX) <= Outline.PRECISION || Math.abs(height - marginY) <= Outline.PRECISION) {
      const tx2 = newX + newWidth / 2 - (x + width / 2);
      const ty2 = newY + newHeight / 2 - (y + height / 2);
      for (const {
        line,
        points
      } of this.#lines) {
        Outline._translate(line, tx2, ty2, line);
        Outline._translate(points, tx2, ty2, points);
      }
      return {
        root: {
          viewBox: this.viewBox
        },
        path: {
          "transform-origin": `${Outline.svgRound(newX)} ${Outline.svgRound(newY)}`,
          transform: this.rotationTransform || null,
          d: this.toSVGPath()
        }
      };
    }
    const s1x = (newWidth - 2 * marginX) / (width - 2 * marginX);
    const s1y = (newHeight - 2 * marginY) / (height - 2 * marginY);
    const tx = -s1x * (x + marginX) + newX + marginX;
    const ty = -s1y * (y + marginY) + newY + marginY;
    if (s1x !== 1 || s1y !== 1 || tx !== 0 || ty !== 0) {
      for (const {
        line,
        points
      } of this.#lines) {
        Outline._rescale(line, tx, ty, s1x, s1y, line);
        Outline._rescale(points, tx, ty, s1x, s1y, points);
      }
    }
    return {
      root: {
        viewBox: this.viewBox
      },
      path: {
        "transform-origin": `${Outline.svgRound(newX)} ${Outline.svgRound(newY)}`,
        transform: this.rotationTransform || null,
        d: this.toSVGPath()
      }
    };
  }
  getPathTranslatedSVGProperties([newX, newY], parentDimensions) {
    const [newParentWidth, newParentHeight] = parentDimensions;
    const bbox = this.#bbox;
    const tx = newX - bbox[0];
    const ty = newY - bbox[1];
    if (this.#parentWidth === newParentWidth && this.#parentHeight === newParentHeight) {
      for (const {
        line,
        points
      } of this.#lines) {
        Outline._translate(line, tx, ty, line);
        Outline._translate(points, tx, ty, points);
      }
    } else {
      const sx = this.#parentWidth / newParentWidth;
      const sy = this.#parentHeight / newParentHeight;
      this.#parentWidth = newParentWidth;
      this.#parentHeight = newParentHeight;
      for (const {
        line,
        points
      } of this.#lines) {
        Outline._rescale(line, tx, ty, sx, sy, line);
        Outline._rescale(points, tx, ty, sx, sy, points);
      }
      bbox[2] *= sx;
      bbox[3] *= sy;
    }
    bbox[0] = newX;
    bbox[1] = newY;
    return {
      root: {
        viewBox: this.viewBox
      },
      path: {
        d: this.toSVGPath(),
        "transform-origin": `${Outline.svgRound(newX)} ${Outline.svgRound(newY)}`
      }
    };
  }
  get defaultSVGProperties() {
    const bbox = this.#bbox;
    return {
      root: {
        viewBox: this.viewBox
      },
      rootClass: {
        draw: true
      },
      path: {
        d: this.toSVGPath(),
        "transform-origin": `${Outline.svgRound(bbox[0])} ${Outline.svgRound(bbox[1])}`,
        transform: this.rotationTransform || null
      },
      bbox
    };
  }
};
var InkDrawingOptions = class _InkDrawingOptions extends DrawingOptions {
  #viewParameters;
  constructor(viewerParameters) {
    super();
    this.#viewParameters = viewerParameters;
    super.updateProperties({
      fill: "none",
      stroke: AnnotationEditor._defaultLineColor,
      "stroke-opacity": 1,
      "stroke-width": 1,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "stroke-miterlimit": 10
    });
  }
  updateSVGProperty(name, value) {
    if (name === "stroke-width") {
      value ??= this["stroke-width"];
      value *= this.#viewParameters.realScale;
    }
    super.updateSVGProperty(name, value);
  }
  clone() {
    const clone = new _InkDrawingOptions(this.#viewParameters);
    clone.updateAll(this);
    return clone;
  }
};
var InkEditor = class _InkEditor extends DrawingEditor {
  static _type = "ink";
  static _editorType = AnnotationEditorType.INK;
  static _defaultDrawingOptions = null;
  constructor(params) {
    super({
      ...params,
      name: "inkEditor"
    });
    this._willKeepAspectRatio = true;
  }
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
    this._defaultDrawingOptions = new InkDrawingOptions(uiManager.viewParameters);
  }
  static getDefaultDrawingOptions(options) {
    const clone = this._defaultDrawingOptions.clone();
    clone.updateProperties(options);
    return clone;
  }
  static get supportMultipleDrawings() {
    return true;
  }
  static get typesMap() {
    return shadow(this, "typesMap", /* @__PURE__ */ new Map([[AnnotationEditorParamsType.INK_THICKNESS, "stroke-width"], [AnnotationEditorParamsType.INK_COLOR, "stroke"], [AnnotationEditorParamsType.INK_OPACITY, "stroke-opacity"]]));
  }
  static createDrawerInstance(x, y, parentWidth, parentHeight, rotation) {
    return new InkDrawOutliner(x, y, parentWidth, parentHeight, rotation, this._defaultDrawingOptions["stroke-width"]);
  }
  static deserializeDraw(pageX, pageY, pageWidth, pageHeight, innerMargin, data) {
    return InkDrawOutline.deserialize(pageX, pageY, pageWidth, pageHeight, innerMargin, data);
  }
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    if (data instanceof InkAnnotationElement) {
      const {
        data: {
          inkLists,
          rect,
          rotation,
          id,
          color,
          opacity,
          borderStyle: {
            rawWidth: thickness
          },
          popupRef
        },
        parent: {
          page: {
            pageNumber
          }
        }
      } = data;
      initialData = data = {
        annotationType: AnnotationEditorType.INK,
        color: Array.from(color),
        thickness,
        opacity,
        paths: {
          points: inkLists
        },
        boxes: null,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        id,
        deleted: false,
        popupRef
      };
    }
    const editor = await super.deserialize(data, parent, uiManager);
    editor.annotationElementId = data.id || null;
    editor._initialData = initialData;
    return editor;
  }
  onScaleChanging() {
    if (!this.parent) {
      return;
    }
    super.onScaleChanging();
    const {
      _drawId,
      _drawingOptions,
      parent
    } = this;
    _drawingOptions.updateSVGProperty("stroke-width");
    parent.drawLayer.updateProperties(_drawId, _drawingOptions.toSVGProperties());
  }
  static onScaleChangingWhenDrawing() {
    const parent = this._currentParent;
    if (!parent) {
      return;
    }
    super.onScaleChangingWhenDrawing();
    this._defaultDrawingOptions.updateSVGProperty("stroke-width");
    parent.drawLayer.updateProperties(this._currentDrawId, this._defaultDrawingOptions.toSVGProperties());
  }
  createDrawingOptions({
    color,
    thickness,
    opacity
  }) {
    this._drawingOptions = _InkEditor.getDefaultDrawingOptions({
      stroke: Util.makeHexColor(...color),
      "stroke-width": thickness,
      "stroke-opacity": opacity
    });
  }
  serialize(isForCopying = false) {
    if (this.isEmpty()) {
      return null;
    }
    if (this.deleted) {
      return this.serializeDeleted();
    }
    const {
      lines,
      points,
      rect
    } = this.serializeDraw(isForCopying);
    const {
      _drawingOptions: {
        stroke,
        "stroke-opacity": opacity,
        "stroke-width": thickness
      }
    } = this;
    const serialized = {
      annotationType: AnnotationEditorType.INK,
      color: AnnotationEditor._colorManager.convert(stroke),
      opacity,
      thickness,
      paths: {
        lines,
        points
      },
      pageIndex: this.pageIndex,
      rect,
      rotation: this.rotation,
      structTreeParentId: this._structTreeParentId
    };
    if (isForCopying) {
      return serialized;
    }
    if (this.annotationElementId && !this.#hasElementChanged(serialized)) {
      return null;
    }
    serialized.id = this.annotationElementId;
    return serialized;
  }
  #hasElementChanged(serialized) {
    const {
      color,
      thickness,
      opacity,
      pageIndex
    } = this._initialData;
    return this._hasBeenMoved || this._hasBeenResized || serialized.color.some((c, i) => c !== color[i]) || serialized.thickness !== thickness || serialized.opacity !== opacity || serialized.pageIndex !== pageIndex;
  }
  renderAnnotationElement(annotation) {
    const {
      points,
      rect
    } = this.serializeDraw(false);
    annotation.updateEdited({
      rect,
      thickness: this._drawingOptions["stroke-width"],
      points
    });
    return null;
  }
};
var StampEditor = class _StampEditor extends AnnotationEditor {
  #bitmap = null;
  #bitmapId = null;
  #bitmapPromise = null;
  #bitmapUrl = null;
  #bitmapFile = null;
  #bitmapFileName = "";
  #canvas = null;
  #resizeTimeoutId = null;
  #isSvg = false;
  #hasBeenAddedInUndoStack = false;
  static _type = "stamp";
  static _editorType = AnnotationEditorType.STAMP;
  constructor(params) {
    super({
      ...params,
      name: "stampEditor"
    });
    this.#bitmapUrl = params.bitmapUrl;
    this.#bitmapFile = params.bitmapFile;
  }
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
  }
  static get supportedTypes() {
    const types = ["apng", "avif", "bmp", "gif", "jpeg", "png", "svg+xml", "webp", "x-icon"];
    return shadow(this, "supportedTypes", types.map((type) => `image/${type}`));
  }
  static get supportedTypesStr() {
    return shadow(this, "supportedTypesStr", this.supportedTypes.join(","));
  }
  static isHandlingMimeForPasting(mime) {
    return this.supportedTypes.includes(mime);
  }
  static paste(item, parent) {
    parent.pasteEditor(AnnotationEditorType.STAMP, {
      bitmapFile: item.getAsFile()
    });
  }
  altTextFinish() {
    if (this._uiManager.useNewAltTextFlow) {
      this.div.hidden = false;
    }
    super.altTextFinish();
  }
  get telemetryFinalData() {
    return {
      type: "stamp",
      hasAltText: !!this.altTextData?.altText
    };
  }
  static computeTelemetryFinalData(data) {
    const hasAltTextStats = data.get("hasAltText");
    return {
      hasAltText: hasAltTextStats.get(true) ?? 0,
      hasNoAltText: hasAltTextStats.get(false) ?? 0
    };
  }
  #getBitmapFetched(data, fromId = false) {
    if (!data) {
      this.remove();
      return;
    }
    this.#bitmap = data.bitmap;
    if (!fromId) {
      this.#bitmapId = data.id;
      this.#isSvg = data.isSvg;
    }
    if (data.file) {
      this.#bitmapFileName = data.file.name;
    }
    this.#createCanvas();
  }
  #getBitmapDone() {
    this.#bitmapPromise = null;
    this._uiManager.enableWaiting(false);
    if (!this.#canvas) {
      return;
    }
    if (this._uiManager.useNewAltTextWhenAddingImage && this._uiManager.useNewAltTextFlow && this.#bitmap) {
      this._editToolbar.hide();
      this._uiManager.editAltText(this, true);
      return;
    }
    if (!this._uiManager.useNewAltTextWhenAddingImage && this._uiManager.useNewAltTextFlow && this.#bitmap) {
      this._reportTelemetry({
        action: "pdfjs.image.image_added",
        data: {
          alt_text_modal: false,
          alt_text_type: "empty"
        }
      });
      try {
        this.mlGuessAltText();
      } catch {
      }
    }
    this.div.focus();
  }
  async mlGuessAltText(imageData = null, updateAltTextData = true) {
    if (this.hasAltTextData()) {
      return null;
    }
    const {
      mlManager
    } = this._uiManager;
    if (!mlManager) {
      throw new Error("No ML.");
    }
    if (!await mlManager.isEnabledFor("altText")) {
      throw new Error("ML isn't enabled for alt text.");
    }
    const {
      data,
      width,
      height
    } = imageData || this.copyCanvas(null, null, true).imageData;
    const response = await mlManager.guess({
      name: "altText",
      request: {
        data,
        width,
        height,
        channels: data.length / (width * height)
      }
    });
    if (!response) {
      throw new Error("No response from the AI service.");
    }
    if (response.error) {
      throw new Error("Error from the AI service.");
    }
    if (response.cancel) {
      return null;
    }
    if (!response.output) {
      throw new Error("No valid response from the AI service.");
    }
    const altText = response.output;
    await this.setGuessedAltText(altText);
    if (updateAltTextData && !this.hasAltTextData()) {
      this.altTextData = {
        alt: altText,
        decorative: false
      };
    }
    return altText;
  }
  #getBitmap() {
    if (this.#bitmapId) {
      this._uiManager.enableWaiting(true);
      this._uiManager.imageManager.getFromId(this.#bitmapId).then((data) => this.#getBitmapFetched(data, true)).finally(() => this.#getBitmapDone());
      return;
    }
    if (this.#bitmapUrl) {
      const url = this.#bitmapUrl;
      this.#bitmapUrl = null;
      this._uiManager.enableWaiting(true);
      this.#bitmapPromise = this._uiManager.imageManager.getFromUrl(url).then((data) => this.#getBitmapFetched(data)).finally(() => this.#getBitmapDone());
      return;
    }
    if (this.#bitmapFile) {
      const file = this.#bitmapFile;
      this.#bitmapFile = null;
      this._uiManager.enableWaiting(true);
      this.#bitmapPromise = this._uiManager.imageManager.getFromFile(file).then((data) => this.#getBitmapFetched(data)).finally(() => this.#getBitmapDone());
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = _StampEditor.supportedTypesStr;
    const signal = this._uiManager._signal;
    this.#bitmapPromise = new Promise((resolve) => {
      input.addEventListener("change", async () => {
        if (!input.files || input.files.length === 0) {
          this.remove();
        } else {
          this._uiManager.enableWaiting(true);
          const data = await this._uiManager.imageManager.getFromFile(input.files[0]);
          this._reportTelemetry({
            action: "pdfjs.image.image_selected",
            data: {
              alt_text_modal: this._uiManager.useNewAltTextFlow
            }
          });
          this.#getBitmapFetched(data);
        }
        resolve();
      }, {
        signal
      });
      input.addEventListener("cancel", () => {
        this.remove();
        resolve();
      }, {
        signal
      });
    }).finally(() => this.#getBitmapDone());
    input.click();
  }
  remove() {
    if (this.#bitmapId) {
      this.#bitmap = null;
      this._uiManager.imageManager.deleteId(this.#bitmapId);
      this.#canvas?.remove();
      this.#canvas = null;
      if (this.#resizeTimeoutId) {
        clearTimeout(this.#resizeTimeoutId);
        this.#resizeTimeoutId = null;
      }
    }
    super.remove();
  }
  rebuild() {
    if (!this.parent) {
      if (this.#bitmapId) {
        this.#getBitmap();
      }
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }
    if (this.#bitmapId && this.#canvas === null) {
      this.#getBitmap();
    }
    if (!this.isAttachedToDOM) {
      this.parent.add(this);
    }
  }
  onceAdded(focus) {
    this._isDraggable = true;
    if (focus) {
      this.div.focus();
    }
  }
  isEmpty() {
    return !(this.#bitmapPromise || this.#bitmap || this.#bitmapUrl || this.#bitmapFile || this.#bitmapId);
  }
  get isResizable() {
    return true;
  }
  render() {
    if (this.div) {
      return this.div;
    }
    let baseX, baseY;
    if (this.width) {
      baseX = this.x;
      baseY = this.y;
    }
    super.render();
    this.div.hidden = true;
    this.div.setAttribute("role", "figure");
    this.addAltTextButton();
    if (this.#bitmap) {
      this.#createCanvas();
    } else {
      this.#getBitmap();
    }
    if (this.width && !this.annotationElementId) {
      const [parentWidth, parentHeight] = this.parentDimensions;
      this.setAt(baseX * parentWidth, baseY * parentHeight, this.width * parentWidth, this.height * parentHeight);
    }
    this._uiManager.addShouldRescale(this);
    return this.div;
  }
  _onResized() {
    this.onScaleChanging();
  }
  onScaleChanging() {
    if (!this.parent) {
      return;
    }
    if (this.#resizeTimeoutId !== null) {
      clearTimeout(this.#resizeTimeoutId);
    }
    const TIME_TO_WAIT = 200;
    this.#resizeTimeoutId = setTimeout(() => {
      this.#resizeTimeoutId = null;
      this.#drawBitmap();
    }, TIME_TO_WAIT);
  }
  #createCanvas() {
    const {
      div
    } = this;
    let {
      width,
      height
    } = this.#bitmap;
    const [pageWidth, pageHeight] = this.pageDimensions;
    const MAX_RATIO = 0.75;
    if (this.width) {
      width = this.width * pageWidth;
      height = this.height * pageHeight;
    } else if (width > MAX_RATIO * pageWidth || height > MAX_RATIO * pageHeight) {
      const factor = Math.min(MAX_RATIO * pageWidth / width, MAX_RATIO * pageHeight / height);
      width *= factor;
      height *= factor;
    }
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(width * parentWidth / pageWidth, height * parentHeight / pageHeight);
    this._uiManager.enableWaiting(false);
    const canvas = this.#canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    this.addContainer(canvas);
    this.width = width / pageWidth;
    this.height = height / pageHeight;
    if (this._initialOptions?.isCentered) {
      this.center();
    } else {
      this.fixAndSetPosition();
    }
    this._initialOptions = null;
    if (!this._uiManager.useNewAltTextWhenAddingImage || !this._uiManager.useNewAltTextFlow || this.annotationElementId) {
      div.hidden = false;
    }
    this.#drawBitmap();
    if (!this.#hasBeenAddedInUndoStack) {
      this.parent.addUndoableEditor(this);
      this.#hasBeenAddedInUndoStack = true;
    }
    this._reportTelemetry({
      action: "inserted_image"
    });
    if (this.#bitmapFileName) {
      canvas.setAttribute("aria-label", this.#bitmapFileName);
    }
  }
  copyCanvas(maxDataDimension, maxPreviewDimension, createImageData = false) {
    if (!maxDataDimension) {
      maxDataDimension = 224;
    }
    const {
      width: bitmapWidth,
      height: bitmapHeight
    } = this.#bitmap;
    const outputScale = new OutputScale();
    let bitmap = this.#bitmap;
    let width = bitmapWidth, height = bitmapHeight;
    let canvas = null;
    if (maxPreviewDimension) {
      if (bitmapWidth > maxPreviewDimension || bitmapHeight > maxPreviewDimension) {
        const ratio = Math.min(maxPreviewDimension / bitmapWidth, maxPreviewDimension / bitmapHeight);
        width = Math.floor(bitmapWidth * ratio);
        height = Math.floor(bitmapHeight * ratio);
      }
      canvas = document.createElement("canvas");
      const scaledWidth = canvas.width = Math.ceil(width * outputScale.sx);
      const scaledHeight = canvas.height = Math.ceil(height * outputScale.sy);
      if (!this.#isSvg) {
        bitmap = this.#scaleBitmap(scaledWidth, scaledHeight);
      }
      const ctx = canvas.getContext("2d");
      ctx.filter = this._uiManager.hcmFilter;
      let white = "white", black = "#cfcfd8";
      if (this._uiManager.hcmFilter !== "none") {
        black = "black";
      } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        white = "#8f8f9d";
        black = "#42414d";
      }
      const boxDim = 15;
      const boxDimWidth = boxDim * outputScale.sx;
      const boxDimHeight = boxDim * outputScale.sy;
      const pattern = new OffscreenCanvas(boxDimWidth * 2, boxDimHeight * 2);
      const patternCtx = pattern.getContext("2d");
      patternCtx.fillStyle = white;
      patternCtx.fillRect(0, 0, boxDimWidth * 2, boxDimHeight * 2);
      patternCtx.fillStyle = black;
      patternCtx.fillRect(0, 0, boxDimWidth, boxDimHeight);
      patternCtx.fillRect(boxDimWidth, boxDimHeight, boxDimWidth, boxDimHeight);
      ctx.fillStyle = ctx.createPattern(pattern, "repeat");
      ctx.fillRect(0, 0, scaledWidth, scaledHeight);
      ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, scaledWidth, scaledHeight);
    }
    let imageData = null;
    if (createImageData) {
      let dataWidth, dataHeight;
      if (outputScale.symmetric && bitmap.width < maxDataDimension && bitmap.height < maxDataDimension) {
        dataWidth = bitmap.width;
        dataHeight = bitmap.height;
      } else {
        bitmap = this.#bitmap;
        if (bitmapWidth > maxDataDimension || bitmapHeight > maxDataDimension) {
          const ratio = Math.min(maxDataDimension / bitmapWidth, maxDataDimension / bitmapHeight);
          dataWidth = Math.floor(bitmapWidth * ratio);
          dataHeight = Math.floor(bitmapHeight * ratio);
          if (!this.#isSvg) {
            bitmap = this.#scaleBitmap(dataWidth, dataHeight);
          }
        }
      }
      const offscreen = new OffscreenCanvas(dataWidth, dataHeight);
      const offscreenCtx = offscreen.getContext("2d", {
        willReadFrequently: true
      });
      offscreenCtx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, dataWidth, dataHeight);
      imageData = {
        width: dataWidth,
        height: dataHeight,
        data: offscreenCtx.getImageData(0, 0, dataWidth, dataHeight).data
      };
    }
    return {
      canvas,
      width,
      height,
      imageData
    };
  }
  #scaleBitmap(width, height) {
    const {
      width: bitmapWidth,
      height: bitmapHeight
    } = this.#bitmap;
    let newWidth = bitmapWidth;
    let newHeight = bitmapHeight;
    let bitmap = this.#bitmap;
    while (newWidth > 2 * width || newHeight > 2 * height) {
      const prevWidth = newWidth;
      const prevHeight = newHeight;
      if (newWidth > 2 * width) {
        newWidth = newWidth >= 16384 ? Math.floor(newWidth / 2) - 1 : Math.ceil(newWidth / 2);
      }
      if (newHeight > 2 * height) {
        newHeight = newHeight >= 16384 ? Math.floor(newHeight / 2) - 1 : Math.ceil(newHeight / 2);
      }
      const offscreen = new OffscreenCanvas(newWidth, newHeight);
      const ctx = offscreen.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, prevWidth, prevHeight, 0, 0, newWidth, newHeight);
      bitmap = offscreen.transferToImageBitmap();
    }
    return bitmap;
  }
  #drawBitmap() {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const {
      width,
      height
    } = this;
    const outputScale = new OutputScale();
    const scaledWidth = Math.ceil(width * parentWidth * outputScale.sx);
    const scaledHeight = Math.ceil(height * parentHeight * outputScale.sy);
    const canvas = this.#canvas;
    if (!canvas || canvas.width === scaledWidth && canvas.height === scaledHeight) {
      return;
    }
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
    const bitmap = this.#isSvg ? this.#bitmap : this.#scaleBitmap(scaledWidth, scaledHeight);
    const ctx = canvas.getContext("2d");
    ctx.filter = this._uiManager.hcmFilter;
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, scaledWidth, scaledHeight);
  }
  getImageForAltText() {
    return this.#canvas;
  }
  #serializeBitmap(toUrl) {
    if (toUrl) {
      if (this.#isSvg) {
        const url = this._uiManager.imageManager.getSvgUrl(this.#bitmapId);
        if (url) {
          return url;
        }
      }
      const canvas = document.createElement("canvas");
      ({
        width: canvas.width,
        height: canvas.height
      } = this.#bitmap);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(this.#bitmap, 0, 0);
      return canvas.toDataURL();
    }
    if (this.#isSvg) {
      const [pageWidth, pageHeight] = this.pageDimensions;
      const width = Math.round(this.width * pageWidth * PixelsPerInch.PDF_TO_CSS_UNITS);
      const height = Math.round(this.height * pageHeight * PixelsPerInch.PDF_TO_CSS_UNITS);
      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext("2d");
      ctx.drawImage(this.#bitmap, 0, 0, this.#bitmap.width, this.#bitmap.height, 0, 0, width, height);
      return offscreen.transferToImageBitmap();
    }
    return structuredClone(this.#bitmap);
  }
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    if (data instanceof StampAnnotationElement) {
      const {
        data: {
          rect: rect2,
          rotation,
          id,
          structParent,
          popupRef
        },
        container,
        parent: {
          page: {
            pageNumber
          }
        }
      } = data;
      const canvas = container.querySelector("canvas");
      const imageData = uiManager.imageManager.getFromCanvas(container.id, canvas);
      canvas.remove();
      const altText = (await parent._structTree.getAriaAttributes(`${AnnotationPrefix}${id}`))?.get("aria-label") || "";
      initialData = data = {
        annotationType: AnnotationEditorType.STAMP,
        bitmapId: imageData.id,
        bitmap: imageData.bitmap,
        pageIndex: pageNumber - 1,
        rect: rect2.slice(0),
        rotation,
        id,
        deleted: false,
        accessibilityData: {
          decorative: false,
          altText
        },
        isSvg: false,
        structParent,
        popupRef
      };
    }
    const editor = await super.deserialize(data, parent, uiManager);
    const {
      rect,
      bitmap,
      bitmapUrl,
      bitmapId,
      isSvg,
      accessibilityData
    } = data;
    if (bitmapId && uiManager.imageManager.isValidId(bitmapId)) {
      editor.#bitmapId = bitmapId;
      if (bitmap) {
        editor.#bitmap = bitmap;
      }
    } else {
      editor.#bitmapUrl = bitmapUrl;
    }
    editor.#isSvg = isSvg;
    const [parentWidth, parentHeight] = editor.pageDimensions;
    editor.width = (rect[2] - rect[0]) / parentWidth;
    editor.height = (rect[3] - rect[1]) / parentHeight;
    editor.annotationElementId = data.id || null;
    if (accessibilityData) {
      editor.altTextData = accessibilityData;
    }
    editor._initialData = initialData;
    editor.#hasBeenAddedInUndoStack = !!initialData;
    return editor;
  }
  serialize(isForCopying = false, context = null) {
    if (this.isEmpty()) {
      return null;
    }
    if (this.deleted) {
      return this.serializeDeleted();
    }
    const serialized = {
      annotationType: AnnotationEditorType.STAMP,
      bitmapId: this.#bitmapId,
      pageIndex: this.pageIndex,
      rect: this.getRect(0, 0),
      rotation: this.rotation,
      isSvg: this.#isSvg,
      structTreeParentId: this._structTreeParentId
    };
    if (isForCopying) {
      serialized.bitmapUrl = this.#serializeBitmap(true);
      serialized.accessibilityData = this.serializeAltText(true);
      return serialized;
    }
    const {
      decorative,
      altText
    } = this.serializeAltText(false);
    if (!decorative && altText) {
      serialized.accessibilityData = {
        type: "Figure",
        alt: altText
      };
    }
    if (this.annotationElementId) {
      const changes = this.#hasElementChanged(serialized);
      if (changes.isSame) {
        return null;
      }
      if (changes.isSameAltText) {
        delete serialized.accessibilityData;
      } else {
        serialized.accessibilityData.structParent = this._initialData.structParent ?? -1;
      }
    }
    serialized.id = this.annotationElementId;
    if (context === null) {
      return serialized;
    }
    context.stamps ||= /* @__PURE__ */ new Map();
    const area = this.#isSvg ? (serialized.rect[2] - serialized.rect[0]) * (serialized.rect[3] - serialized.rect[1]) : null;
    if (!context.stamps.has(this.#bitmapId)) {
      context.stamps.set(this.#bitmapId, {
        area,
        serialized
      });
      serialized.bitmap = this.#serializeBitmap(false);
    } else if (this.#isSvg) {
      const prevData = context.stamps.get(this.#bitmapId);
      if (area > prevData.area) {
        prevData.area = area;
        prevData.serialized.bitmap.close();
        prevData.serialized.bitmap = this.#serializeBitmap(false);
      }
    }
    return serialized;
  }
  #hasElementChanged(serialized) {
    const {
      pageIndex,
      accessibilityData: {
        altText
      }
    } = this._initialData;
    const isSamePageIndex = serialized.pageIndex === pageIndex;
    const isSameAltText = (serialized.accessibilityData?.alt || "") === altText;
    return {
      isSame: !this._hasBeenMoved && !this._hasBeenResized && isSamePageIndex && isSameAltText,
      isSameAltText
    };
  }
  renderAnnotationElement(annotation) {
    annotation.updateEdited({
      rect: this.getRect(0, 0)
    });
    return null;
  }
};
var AnnotationEditorLayer = class _AnnotationEditorLayer {
  #accessibilityManager;
  #allowClick = false;
  #annotationLayer = null;
  #clickAC = null;
  #editorFocusTimeoutId = null;
  #editors = /* @__PURE__ */ new Map();
  #hadPointerDown = false;
  #isDisabling = false;
  #isEnabling = false;
  #drawingAC = null;
  #focusedElement = null;
  #textLayer = null;
  #textSelectionAC = null;
  #uiManager;
  static _initialized = false;
  static #editorTypes = new Map([FreeTextEditor, InkEditor, StampEditor, HighlightEditor].map((type) => [type._editorType, type]));
  constructor({
    uiManager,
    pageIndex,
    div,
    structTreeLayer,
    accessibilityManager,
    annotationLayer,
    drawLayer,
    textLayer,
    viewport,
    l10n
  }) {
    const editorTypes = [..._AnnotationEditorLayer.#editorTypes.values()];
    if (!_AnnotationEditorLayer._initialized) {
      _AnnotationEditorLayer._initialized = true;
      for (const editorType of editorTypes) {
        editorType.initialize(l10n, uiManager);
      }
    }
    uiManager.registerEditorTypes(editorTypes);
    this.#uiManager = uiManager;
    this.pageIndex = pageIndex;
    this.div = div;
    this.#accessibilityManager = accessibilityManager;
    this.#annotationLayer = annotationLayer;
    this.viewport = viewport;
    this.#textLayer = textLayer;
    this.drawLayer = drawLayer;
    this._structTree = structTreeLayer;
    this.#uiManager.addLayer(this);
  }
  get isEmpty() {
    return this.#editors.size === 0;
  }
  get isInvisible() {
    return this.isEmpty && this.#uiManager.getMode() === AnnotationEditorType.NONE;
  }
  updateToolbar(mode) {
    this.#uiManager.updateToolbar(mode);
  }
  updateMode(mode = this.#uiManager.getMode()) {
    this.#cleanup();
    switch (mode) {
      case AnnotationEditorType.NONE:
        this.disableTextSelection();
        this.togglePointerEvents(false);
        this.toggleAnnotationLayerPointerEvents(true);
        this.disableClick();
        return;
      case AnnotationEditorType.INK:
        this.disableTextSelection();
        this.togglePointerEvents(true);
        this.enableClick();
        break;
      case AnnotationEditorType.HIGHLIGHT:
        this.enableTextSelection();
        this.togglePointerEvents(false);
        this.disableClick();
        break;
      default:
        this.disableTextSelection();
        this.togglePointerEvents(true);
        this.enableClick();
    }
    this.toggleAnnotationLayerPointerEvents(false);
    const {
      classList
    } = this.div;
    for (const editorType of _AnnotationEditorLayer.#editorTypes.values()) {
      classList.toggle(`${editorType._type}Editing`, mode === editorType._editorType);
    }
    this.div.hidden = false;
  }
  hasTextLayer(textLayer) {
    return textLayer === this.#textLayer?.div;
  }
  setEditingState(isEditing) {
    this.#uiManager.setEditingState(isEditing);
  }
  addCommands(params) {
    this.#uiManager.addCommands(params);
  }
  cleanUndoStack(type) {
    this.#uiManager.cleanUndoStack(type);
  }
  toggleDrawing(enabled = false) {
    this.div.classList.toggle("drawing", !enabled);
  }
  togglePointerEvents(enabled = false) {
    this.div.classList.toggle("disabled", !enabled);
  }
  toggleAnnotationLayerPointerEvents(enabled = false) {
    this.#annotationLayer?.div.classList.toggle("disabled", !enabled);
  }
  async enable() {
    this.#isEnabling = true;
    this.div.tabIndex = 0;
    this.togglePointerEvents(true);
    const annotationElementIds = /* @__PURE__ */ new Set();
    for (const editor of this.#editors.values()) {
      editor.enableEditing();
      editor.show(true);
      if (editor.annotationElementId) {
        this.#uiManager.removeChangedExistingAnnotation(editor);
        annotationElementIds.add(editor.annotationElementId);
      }
    }
    if (!this.#annotationLayer) {
      this.#isEnabling = false;
      return;
    }
    const editables = this.#annotationLayer.getEditableAnnotations();
    for (const editable of editables) {
      editable.hide();
      if (this.#uiManager.isDeletedAnnotationElement(editable.data.id)) {
        continue;
      }
      if (annotationElementIds.has(editable.data.id)) {
        continue;
      }
      const editor = await this.deserialize(editable);
      if (!editor) {
        continue;
      }
      this.addOrRebuild(editor);
      editor.enableEditing();
    }
    this.#isEnabling = false;
  }
  disable() {
    this.#isDisabling = true;
    this.div.tabIndex = -1;
    this.togglePointerEvents(false);
    const changedAnnotations = /* @__PURE__ */ new Map();
    const resetAnnotations = /* @__PURE__ */ new Map();
    for (const editor of this.#editors.values()) {
      editor.disableEditing();
      if (!editor.annotationElementId) {
        continue;
      }
      if (editor.serialize() !== null) {
        changedAnnotations.set(editor.annotationElementId, editor);
        continue;
      } else {
        resetAnnotations.set(editor.annotationElementId, editor);
      }
      this.getEditableAnnotation(editor.annotationElementId)?.show();
      editor.remove();
    }
    if (this.#annotationLayer) {
      const editables = this.#annotationLayer.getEditableAnnotations();
      for (const editable of editables) {
        const {
          id
        } = editable.data;
        if (this.#uiManager.isDeletedAnnotationElement(id)) {
          continue;
        }
        let editor = resetAnnotations.get(id);
        if (editor) {
          editor.resetAnnotationElement(editable);
          editor.show(false);
          editable.show();
          continue;
        }
        editor = changedAnnotations.get(id);
        if (editor) {
          this.#uiManager.addChangedExistingAnnotation(editor);
          if (editor.renderAnnotationElement(editable)) {
            editor.show(false);
          }
        }
        editable.show();
      }
    }
    this.#cleanup();
    if (this.isEmpty) {
      this.div.hidden = true;
    }
    const {
      classList
    } = this.div;
    for (const editorType of _AnnotationEditorLayer.#editorTypes.values()) {
      classList.remove(`${editorType._type}Editing`);
    }
    this.disableTextSelection();
    this.toggleAnnotationLayerPointerEvents(true);
    this.#isDisabling = false;
  }
  getEditableAnnotation(id) {
    return this.#annotationLayer?.getEditableAnnotation(id) || null;
  }
  setActiveEditor(editor) {
    const currentActive = this.#uiManager.getActive();
    if (currentActive === editor) {
      return;
    }
    this.#uiManager.setActiveEditor(editor);
  }
  enableTextSelection() {
    this.div.tabIndex = -1;
    if (this.#textLayer?.div && !this.#textSelectionAC) {
      this.#textSelectionAC = new AbortController();
      const signal = this.#uiManager.combinedSignal(this.#textSelectionAC);
      this.#textLayer.div.addEventListener("pointerdown", this.#textLayerPointerDown.bind(this), {
        signal
      });
      this.#textLayer.div.classList.add("highlighting");
    }
  }
  disableTextSelection() {
    this.div.tabIndex = 0;
    if (this.#textLayer?.div && this.#textSelectionAC) {
      this.#textSelectionAC.abort();
      this.#textSelectionAC = null;
      this.#textLayer.div.classList.remove("highlighting");
    }
  }
  #textLayerPointerDown(event) {
    this.#uiManager.unselectAll();
    const {
      target
    } = event;
    if (target === this.#textLayer.div || (target.getAttribute("role") === "img" || target.classList.contains("endOfContent")) && this.#textLayer.div.contains(target)) {
      const {
        isMac
      } = util_FeatureTest.platform;
      if (event.button !== 0 || event.ctrlKey && isMac) {
        return;
      }
      this.#uiManager.showAllEditors("highlight", true, true);
      this.#textLayer.div.classList.add("free");
      this.toggleDrawing();
      HighlightEditor.startHighlighting(this, this.#uiManager.direction === "ltr", {
        target: this.#textLayer.div,
        x: event.x,
        y: event.y
      });
      this.#textLayer.div.addEventListener("pointerup", () => {
        this.#textLayer.div.classList.remove("free");
        this.toggleDrawing(true);
      }, {
        once: true,
        signal: this.#uiManager._signal
      });
      event.preventDefault();
    }
  }
  enableClick() {
    if (this.#clickAC) {
      return;
    }
    this.#clickAC = new AbortController();
    const signal = this.#uiManager.combinedSignal(this.#clickAC);
    this.div.addEventListener("pointerdown", this.pointerdown.bind(this), {
      signal
    });
    const pointerup = this.pointerup.bind(this);
    this.div.addEventListener("pointerup", pointerup, {
      signal
    });
    this.div.addEventListener("pointercancel", pointerup, {
      signal
    });
  }
  disableClick() {
    this.#clickAC?.abort();
    this.#clickAC = null;
  }
  attach(editor) {
    this.#editors.set(editor.id, editor);
    const {
      annotationElementId
    } = editor;
    if (annotationElementId && this.#uiManager.isDeletedAnnotationElement(annotationElementId)) {
      this.#uiManager.removeDeletedAnnotationElement(editor);
    }
  }
  detach(editor) {
    this.#editors.delete(editor.id);
    this.#accessibilityManager?.removePointerInTextLayer(editor.contentDiv);
    if (!this.#isDisabling && editor.annotationElementId) {
      this.#uiManager.addDeletedAnnotationElement(editor);
    }
  }
  remove(editor) {
    this.detach(editor);
    this.#uiManager.removeEditor(editor);
    editor.div.remove();
    editor.isAttachedToDOM = false;
  }
  changeParent(editor) {
    if (editor.parent === this) {
      return;
    }
    if (editor.parent && editor.annotationElementId) {
      this.#uiManager.addDeletedAnnotationElement(editor.annotationElementId);
      AnnotationEditor.deleteAnnotationElement(editor);
      editor.annotationElementId = null;
    }
    this.attach(editor);
    editor.parent?.detach(editor);
    editor.setParent(this);
    if (editor.div && editor.isAttachedToDOM) {
      editor.div.remove();
      this.div.append(editor.div);
    }
  }
  add(editor) {
    if (editor.parent === this && editor.isAttachedToDOM) {
      return;
    }
    this.changeParent(editor);
    this.#uiManager.addEditor(editor);
    this.attach(editor);
    if (!editor.isAttachedToDOM) {
      const div = editor.render();
      this.div.append(div);
      editor.isAttachedToDOM = true;
    }
    editor.fixAndSetPosition();
    editor.onceAdded(!this.#isEnabling);
    this.#uiManager.addToAnnotationStorage(editor);
    editor._reportTelemetry(editor.telemetryInitialData);
  }
  moveEditorInDOM(editor) {
    if (!editor.isAttachedToDOM) {
      return;
    }
    const {
      activeElement
    } = document;
    if (editor.div.contains(activeElement) && !this.#editorFocusTimeoutId) {
      editor._focusEventsAllowed = false;
      this.#editorFocusTimeoutId = setTimeout(() => {
        this.#editorFocusTimeoutId = null;
        if (!editor.div.contains(document.activeElement)) {
          editor.div.addEventListener("focusin", () => {
            editor._focusEventsAllowed = true;
          }, {
            once: true,
            signal: this.#uiManager._signal
          });
          activeElement.focus();
        } else {
          editor._focusEventsAllowed = true;
        }
      }, 0);
    }
    editor._structTreeParentId = this.#accessibilityManager?.moveElementInDOM(this.div, editor.div, editor.contentDiv, true);
  }
  addOrRebuild(editor) {
    if (editor.needsToBeRebuilt()) {
      editor.parent ||= this;
      editor.rebuild();
      editor.show();
    } else {
      this.add(editor);
    }
  }
  addUndoableEditor(editor) {
    const cmd = () => editor._uiManager.rebuild(editor);
    const undo = () => {
      editor.remove();
    };
    this.addCommands({
      cmd,
      undo,
      mustExec: false
    });
  }
  getNextId() {
    return this.#uiManager.getId();
  }
  get #currentEditorType() {
    return _AnnotationEditorLayer.#editorTypes.get(this.#uiManager.getMode());
  }
  combinedSignal(ac) {
    return this.#uiManager.combinedSignal(ac);
  }
  #createNewEditor(params) {
    const editorType = this.#currentEditorType;
    return editorType ? new editorType.prototype.constructor(params) : null;
  }
  canCreateNewEmptyEditor() {
    return this.#currentEditorType?.canCreateNewEmptyEditor();
  }
  pasteEditor(mode, params) {
    this.#uiManager.updateToolbar(mode);
    this.#uiManager.updateMode(mode);
    const {
      offsetX,
      offsetY
    } = this.#getCenterPoint();
    const id = this.getNextId();
    const editor = this.#createNewEditor({
      parent: this,
      id,
      x: offsetX,
      y: offsetY,
      uiManager: this.#uiManager,
      isCentered: true,
      ...params
    });
    if (editor) {
      this.add(editor);
    }
  }
  async deserialize(data) {
    return await _AnnotationEditorLayer.#editorTypes.get(data.annotationType ?? data.annotationEditorType)?.deserialize(data, this, this.#uiManager) || null;
  }
  createAndAddNewEditor(event, isCentered, data = {}) {
    const id = this.getNextId();
    const editor = this.#createNewEditor({
      parent: this,
      id,
      x: event.offsetX,
      y: event.offsetY,
      uiManager: this.#uiManager,
      isCentered,
      ...data
    });
    if (editor) {
      this.add(editor);
    }
    return editor;
  }
  #getCenterPoint() {
    const {
      x,
      y,
      width,
      height
    } = this.div.getBoundingClientRect();
    const tlX = Math.max(0, x);
    const tlY = Math.max(0, y);
    const brX = Math.min(window.innerWidth, x + width);
    const brY = Math.min(window.innerHeight, y + height);
    const centerX = (tlX + brX) / 2 - x;
    const centerY = (tlY + brY) / 2 - y;
    const [offsetX, offsetY] = this.viewport.rotation % 180 === 0 ? [centerX, centerY] : [centerY, centerX];
    return {
      offsetX,
      offsetY
    };
  }
  addNewEditor() {
    this.createAndAddNewEditor(this.#getCenterPoint(), true);
  }
  setSelected(editor) {
    this.#uiManager.setSelected(editor);
  }
  toggleSelected(editor) {
    this.#uiManager.toggleSelected(editor);
  }
  unselect(editor) {
    this.#uiManager.unselect(editor);
  }
  pointerup(event) {
    const {
      isMac
    } = util_FeatureTest.platform;
    if (event.button !== 0 || event.ctrlKey && isMac) {
      return;
    }
    if (event.target !== this.div) {
      return;
    }
    if (!this.#hadPointerDown) {
      return;
    }
    this.#hadPointerDown = false;
    if (this.#currentEditorType?.isDrawer && this.#currentEditorType.supportMultipleDrawings) {
      return;
    }
    if (!this.#allowClick) {
      this.#allowClick = true;
      return;
    }
    if (this.#uiManager.getMode() === AnnotationEditorType.STAMP) {
      this.#uiManager.unselectAll();
      return;
    }
    this.createAndAddNewEditor(event, false);
  }
  pointerdown(event) {
    if (this.#uiManager.getMode() === AnnotationEditorType.HIGHLIGHT) {
      this.enableTextSelection();
    }
    if (this.#hadPointerDown) {
      this.#hadPointerDown = false;
      return;
    }
    const {
      isMac
    } = util_FeatureTest.platform;
    if (event.button !== 0 || event.ctrlKey && isMac) {
      return;
    }
    if (event.target !== this.div) {
      return;
    }
    this.#hadPointerDown = true;
    if (this.#currentEditorType?.isDrawer) {
      this.startDrawingSession(event);
      return;
    }
    const editor = this.#uiManager.getActive();
    this.#allowClick = !editor || editor.isEmpty();
  }
  startDrawingSession(event) {
    this.div.focus();
    if (this.#drawingAC) {
      this.#currentEditorType.startDrawing(this, this.#uiManager, false, event);
      return;
    }
    this.#uiManager.setCurrentDrawingSession(this);
    this.#drawingAC = new AbortController();
    const signal = this.#uiManager.combinedSignal(this.#drawingAC);
    this.div.addEventListener("blur", ({
      relatedTarget
    }) => {
      if (relatedTarget && !this.div.contains(relatedTarget)) {
        this.#focusedElement = null;
        this.commitOrRemove();
      }
    }, {
      signal
    });
    this.#currentEditorType.startDrawing(this, this.#uiManager, false, event);
  }
  pause(on) {
    if (on) {
      const {
        activeElement
      } = document;
      if (this.div.contains(activeElement)) {
        this.#focusedElement = activeElement;
      }
      return;
    }
    if (this.#focusedElement) {
      setTimeout(() => {
        this.#focusedElement?.focus();
        this.#focusedElement = null;
      }, 0);
    }
  }
  endDrawingSession(isAborted = false) {
    if (!this.#drawingAC) {
      return null;
    }
    this.#uiManager.setCurrentDrawingSession(null);
    this.#drawingAC.abort();
    this.#drawingAC = null;
    this.#focusedElement = null;
    return this.#currentEditorType.endDrawing(isAborted);
  }
  findNewParent(editor, x, y) {
    const layer = this.#uiManager.findParent(x, y);
    if (layer === null || layer === this) {
      return false;
    }
    layer.changeParent(editor);
    return true;
  }
  commitOrRemove() {
    if (this.#drawingAC) {
      this.endDrawingSession();
      return true;
    }
    return false;
  }
  onScaleChanging() {
    if (!this.#drawingAC) {
      return;
    }
    this.#currentEditorType.onScaleChangingWhenDrawing(this);
  }
  destroy() {
    this.commitOrRemove();
    if (this.#uiManager.getActive()?.parent === this) {
      this.#uiManager.commitOrRemove();
      this.#uiManager.setActiveEditor(null);
    }
    if (this.#editorFocusTimeoutId) {
      clearTimeout(this.#editorFocusTimeoutId);
      this.#editorFocusTimeoutId = null;
    }
    for (const editor of this.#editors.values()) {
      this.#accessibilityManager?.removePointerInTextLayer(editor.contentDiv);
      editor.setParent(null);
      editor.isAttachedToDOM = false;
      editor.div.remove();
    }
    this.div = null;
    this.#editors.clear();
    this.#uiManager.removeLayer(this);
  }
  #cleanup() {
    for (const editor of this.#editors.values()) {
      if (editor.isEmpty()) {
        editor.remove();
      }
    }
  }
  render({
    viewport
  }) {
    this.viewport = viewport;
    setLayerDimensions(this.div, viewport);
    for (const editor of this.#uiManager.getEditors(this.pageIndex)) {
      this.add(editor);
      editor.rebuild();
    }
    this.updateMode();
  }
  update({
    viewport
  }) {
    this.#uiManager.commitOrRemove();
    this.#cleanup();
    const oldRotation = this.viewport.rotation;
    const rotation = viewport.rotation;
    this.viewport = viewport;
    setLayerDimensions(this.div, {
      rotation
    });
    if (oldRotation !== rotation) {
      for (const editor of this.#editors.values()) {
        editor.rotate(rotation);
      }
    }
  }
  get pageDimensions() {
    const {
      pageWidth,
      pageHeight
    } = this.viewport.rawDims;
    return [pageWidth, pageHeight];
  }
  get scale() {
    return this.#uiManager.viewParameters.realScale;
  }
};
var DrawLayer = class _DrawLayer {
  #parent = null;
  #id = 0;
  #mapping = /* @__PURE__ */ new Map();
  #toUpdate = /* @__PURE__ */ new Map();
  constructor({
    pageIndex
  }) {
    this.pageIndex = pageIndex;
  }
  setParent(parent) {
    if (!this.#parent) {
      this.#parent = parent;
      return;
    }
    if (this.#parent !== parent) {
      if (this.#mapping.size > 0) {
        for (const root of this.#mapping.values()) {
          root.remove();
          parent.append(root);
        }
      }
      this.#parent = parent;
    }
  }
  static get _svgFactory() {
    return shadow(this, "_svgFactory", new DOMSVGFactory());
  }
  static #setBox(element, [x, y, width, height]) {
    const {
      style
    } = element;
    style.top = `${100 * y}%`;
    style.left = `${100 * x}%`;
    style.width = `${100 * width}%`;
    style.height = `${100 * height}%`;
  }
  #createSVG() {
    const svg = _DrawLayer._svgFactory.create(1, 1, true);
    this.#parent.append(svg);
    svg.setAttribute("aria-hidden", true);
    return svg;
  }
  #createClipPath(defs, pathId) {
    const clipPath = _DrawLayer._svgFactory.createElement("clipPath");
    defs.append(clipPath);
    const clipPathId = `clip_${pathId}`;
    clipPath.setAttribute("id", clipPathId);
    clipPath.setAttribute("clipPathUnits", "objectBoundingBox");
    const clipPathUse = _DrawLayer._svgFactory.createElement("use");
    clipPath.append(clipPathUse);
    clipPathUse.setAttribute("href", `#${pathId}`);
    clipPathUse.classList.add("clip");
    return clipPathId;
  }
  #updateProperties(element, properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (value === null) {
        element.removeAttribute(key);
      } else {
        element.setAttribute(key, value);
      }
    }
  }
  draw(properties, isPathUpdatable = false, hasClip = false) {
    const id = this.#id++;
    const root = this.#createSVG();
    const defs = _DrawLayer._svgFactory.createElement("defs");
    root.append(defs);
    const path = _DrawLayer._svgFactory.createElement("path");
    defs.append(path);
    const pathId = `path_p${this.pageIndex}_${id}`;
    path.setAttribute("id", pathId);
    path.setAttribute("vector-effect", "non-scaling-stroke");
    if (isPathUpdatable) {
      this.#toUpdate.set(id, path);
    }
    const clipPathId = hasClip ? this.#createClipPath(defs, pathId) : null;
    const use = _DrawLayer._svgFactory.createElement("use");
    root.append(use);
    use.setAttribute("href", `#${pathId}`);
    this.updateProperties(root, properties);
    this.#mapping.set(id, root);
    return {
      id,
      clipPathId: `url(#${clipPathId})`
    };
  }
  drawOutline(properties, mustRemoveSelfIntersections) {
    const id = this.#id++;
    const root = this.#createSVG();
    const defs = _DrawLayer._svgFactory.createElement("defs");
    root.append(defs);
    const path = _DrawLayer._svgFactory.createElement("path");
    defs.append(path);
    const pathId = `path_p${this.pageIndex}_${id}`;
    path.setAttribute("id", pathId);
    path.setAttribute("vector-effect", "non-scaling-stroke");
    let maskId;
    if (mustRemoveSelfIntersections) {
      const mask = _DrawLayer._svgFactory.createElement("mask");
      defs.append(mask);
      maskId = `mask_p${this.pageIndex}_${id}`;
      mask.setAttribute("id", maskId);
      mask.setAttribute("maskUnits", "objectBoundingBox");
      const rect = _DrawLayer._svgFactory.createElement("rect");
      mask.append(rect);
      rect.setAttribute("width", "1");
      rect.setAttribute("height", "1");
      rect.setAttribute("fill", "white");
      const use = _DrawLayer._svgFactory.createElement("use");
      mask.append(use);
      use.setAttribute("href", `#${pathId}`);
      use.setAttribute("stroke", "none");
      use.setAttribute("fill", "black");
      use.setAttribute("fill-rule", "nonzero");
      use.classList.add("mask");
    }
    const use1 = _DrawLayer._svgFactory.createElement("use");
    root.append(use1);
    use1.setAttribute("href", `#${pathId}`);
    if (maskId) {
      use1.setAttribute("mask", `url(#${maskId})`);
    }
    const use2 = use1.cloneNode();
    root.append(use2);
    use1.classList.add("mainOutline");
    use2.classList.add("secondaryOutline");
    this.updateProperties(root, properties);
    this.#mapping.set(id, root);
    return id;
  }
  finalizeDraw(id, properties) {
    this.#toUpdate.delete(id);
    this.updateProperties(id, properties);
  }
  updateProperties(elementOrId, properties) {
    if (!properties) {
      return;
    }
    const {
      root,
      bbox,
      rootClass,
      path
    } = properties;
    const element = typeof elementOrId === "number" ? this.#mapping.get(elementOrId) : elementOrId;
    if (!element) {
      return;
    }
    if (root) {
      this.#updateProperties(element, root);
    }
    if (bbox) {
      _DrawLayer.#setBox(element, bbox);
    }
    if (rootClass) {
      const {
        classList
      } = element;
      for (const [className, value] of Object.entries(rootClass)) {
        classList.toggle(className, value);
      }
    }
    if (path) {
      const defs = element.firstChild;
      const pathElement = defs.firstChild;
      this.#updateProperties(pathElement, path);
    }
  }
  updateParent(id, layer) {
    if (layer === this) {
      return;
    }
    const root = this.#mapping.get(id);
    if (!root) {
      return;
    }
    layer.#parent.append(root);
    this.#mapping.delete(id);
    layer.#mapping.set(id, root);
  }
  remove(id) {
    this.#toUpdate.delete(id);
    if (this.#parent === null) {
      return;
    }
    this.#mapping.get(id).remove();
    this.#mapping.delete(id);
  }
  destroy() {
    this.#parent = null;
    for (const root of this.#mapping.values()) {
      root.remove();
    }
    this.#mapping.clear();
    this.#toUpdate.clear();
  }
};
{
  globalThis.pdfjsTestingUtils = {
    HighlightOutliner
  };
}
var __webpack_exports__AbortException = __webpack_exports__.AbortException;
var __webpack_exports__AnnotationEditorLayer = __webpack_exports__.AnnotationEditorLayer;
var __webpack_exports__AnnotationEditorParamsType = __webpack_exports__.AnnotationEditorParamsType;
var __webpack_exports__AnnotationEditorType = __webpack_exports__.AnnotationEditorType;
var __webpack_exports__AnnotationEditorUIManager = __webpack_exports__.AnnotationEditorUIManager;
var __webpack_exports__AnnotationLayer = __webpack_exports__.AnnotationLayer;
var __webpack_exports__AnnotationMode = __webpack_exports__.AnnotationMode;
var __webpack_exports__ColorPicker = __webpack_exports__.ColorPicker;
var __webpack_exports__DOMSVGFactory = __webpack_exports__.DOMSVGFactory;
var __webpack_exports__DrawLayer = __webpack_exports__.DrawLayer;
var __webpack_exports__FeatureTest = __webpack_exports__.FeatureTest;
var __webpack_exports__GlobalWorkerOptions = __webpack_exports__.GlobalWorkerOptions;
var __webpack_exports__ImageKind = __webpack_exports__.ImageKind;
var __webpack_exports__InvalidPDFException = __webpack_exports__.InvalidPDFException;
var __webpack_exports__MissingPDFException = __webpack_exports__.MissingPDFException;
var __webpack_exports__OPS = __webpack_exports__.OPS;
var __webpack_exports__OutputScale = __webpack_exports__.OutputScale;
var __webpack_exports__PDFDataRangeTransport = __webpack_exports__.PDFDataRangeTransport;
var __webpack_exports__PDFDateString = __webpack_exports__.PDFDateString;
var __webpack_exports__PDFWorker = __webpack_exports__.PDFWorker;
var __webpack_exports__PasswordResponses = __webpack_exports__.PasswordResponses;
var __webpack_exports__PermissionFlag = __webpack_exports__.PermissionFlag;
var __webpack_exports__PixelsPerInch = __webpack_exports__.PixelsPerInch;
var __webpack_exports__RenderingCancelledException = __webpack_exports__.RenderingCancelledException;
var __webpack_exports__TextLayer = __webpack_exports__.TextLayer;
var __webpack_exports__TouchManager = __webpack_exports__.TouchManager;
var __webpack_exports__UnexpectedResponseException = __webpack_exports__.UnexpectedResponseException;
var __webpack_exports__Util = __webpack_exports__.Util;
var __webpack_exports__VerbosityLevel = __webpack_exports__.VerbosityLevel;
var __webpack_exports__XfaLayer = __webpack_exports__.XfaLayer;
var __webpack_exports__build = __webpack_exports__.build;
var __webpack_exports__createValidAbsoluteUrl = __webpack_exports__.createValidAbsoluteUrl;
var __webpack_exports__fetchData = __webpack_exports__.fetchData;
var __webpack_exports__getDocument = __webpack_exports__.getDocument;
var __webpack_exports__getFilenameFromUrl = __webpack_exports__.getFilenameFromUrl;
var __webpack_exports__getPdfFilenameFromUrl = __webpack_exports__.getPdfFilenameFromUrl;
var __webpack_exports__getXfaPageViewport = __webpack_exports__.getXfaPageViewport;
var __webpack_exports__isDataScheme = __webpack_exports__.isDataScheme;
var __webpack_exports__isPdfFile = __webpack_exports__.isPdfFile;
var __webpack_exports__noContextMenu = __webpack_exports__.noContextMenu;
var __webpack_exports__normalizeUnicode = __webpack_exports__.normalizeUnicode;
var __webpack_exports__setLayerDimensions = __webpack_exports__.setLayerDimensions;
var __webpack_exports__shadow = __webpack_exports__.shadow;
var __webpack_exports__stopEvent = __webpack_exports__.stopEvent;
var __webpack_exports__version = __webpack_exports__.version;

// packages/browser-extension/src/pdf-viewer.ts
var DEFAULT_SCALE = 1;
var MIN_SCALE = 0.25;
var MAX_SCALE = 4;
var SCALE_STEP = 0.15;
var RESIZE_RENDER_DELAY_MS = 160;
var ZOOM_RENDER_DELAY_MS = 180;
var VIEWPORT_RENDER_DELAY_MS = 100;
var MAX_CANVAS_PIXELS = 32 * 1024 * 1024;
var MAX_CANVAS_DIMENSION = 8192;
var PDF_LOAD_TIMEOUT_MS = 2e4;
var CREDENTIALED_PDF_LOAD_RETRY_TIMEOUT_MS = 12e3;
var PDF_VIEWER_ANNOTATION_THEME = "light";
var viewer = document.getElementById("viewer");
var titleElement = document.getElementById("onhand-pdf-title");
var statusElement = document.getElementById("onhand-pdf-status");
var pageInput = document.getElementById("onhand-pdf-page");
var pageCountElement = document.getElementById("onhand-pdf-page-count");
var zoomInButton = document.getElementById("onhand-pdf-zoom-in");
var zoomOutButton = document.getElementById("onhand-pdf-zoom-out");
var zoomValueButton = document.getElementById("onhand-pdf-zoom-value");
var pdfDocument = null;
var sourceUrl = "";
var currentScale = DEFAULT_SCALE;
var committedScale = DEFAULT_SCALE;
var scaleMode = "fit";
var renderSequence = 0;
var runtimeBridgePort = null;
var runtimeBridgeReconnectTimer = null;
var annotationSequence = 0;
var resizeRenderTimer = null;
var zoomRenderTimer = null;
var viewportRenderTimer = null;
var gestureAnimationFrame = null;
var zoomRevision = 0;
var queuedGestureScale = DEFAULT_SCALE;
var queuedGestureClientX = 0;
var queuedGestureClientY = 0;
var nativeGestureStartScale = DEFAULT_SCALE;
var transientZoomAnchor = null;
var transientZoomGeometry = null;
var transientZoomCentersHorizontally = false;
var lastFitRenderWidth = 0;
function inlinePdfViewerBridgeStorageKey(pdfUrl) {
  return `onhandInlinePdfViewerBridge:${encodeURIComponent(String(pdfUrl || ""))}`;
}
function waitForNextFrame(timeoutMs = 150) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, timeoutMs);
  });
}
function extensionUrl(path) {
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) return chrome.runtime.getURL(path);
  return path;
}
function serializeBridgeValue(value) {
  if (value == null) return value;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
async function getBridgeToken() {
  if (!sourceUrl || typeof chrome === "undefined" || !chrome?.storage?.session) return "";
  const key = inlinePdfViewerBridgeStorageKey(sourceUrl);
  const stored = await chrome.storage.session.get(key);
  return String(stored?.[key] || "");
}
async function evaluateBridgeExpression(expression) {
  const source = String(expression || "");
  const value = await (0, eval)(source);
  return serializeBridgeValue(value);
}
function rectToObject(rect) {
  if (!rect) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}
function normalizeText(value) {
  return String(value ?? "").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
}
function normalizeSearchChar(char) {
  if (!char) return "";
  if (/\s/.test(char)) return " ";
  return char.normalize("NFKC").replace(/[’`´]/g, "'").toLowerCase();
}
function nextAnnotationId() {
  annotationSequence += 1;
  return `onhand-pdf-${Date.now().toString(36)}-${annotationSequence.toString(36)}`;
}
function getPdfPages() {
  return Array.from(document.querySelectorAll(".page[data-page-number]"));
}
function getPageNumber(page) {
  if (!(page instanceof HTMLElement)) return null;
  const value = Number(page.getAttribute("data-page-number") || "");
  return Number.isFinite(value) && value > 0 ? value : null;
}
function getPdfPageByNumber(pageNumber) {
  if (!Number.isFinite(pageNumber) || pageNumber < 1) return null;
  return document.querySelector(`.page[data-page-number="${Math.floor(pageNumber)}"]`);
}
function visibleEnough(rect) {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
}
function clampScale(value) {
  const scale = Number.isFinite(value) && value > 0 ? value : DEFAULT_SCALE;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(scale.toFixed(3))));
}
function updateZoomControls() {
  const percent = Math.round(currentScale * 100);
  zoomValueButton.textContent = `${percent}%`;
  zoomValueButton.setAttribute("aria-label", `Zoom ${percent}%. Click to fit the page to the window.`);
  zoomOutButton.disabled = currentScale <= MIN_SCALE + 1e-3;
  zoomInButton.disabled = currentScale >= MAX_SCALE - 1e-3;
}
function defaultZoomClientPoint() {
  const toolbar = document.querySelector(".onhand-pdf-toolbar");
  const toolbarBottom = toolbar?.getBoundingClientRect().bottom || 0;
  return {
    clientX: window.innerWidth / 2,
    clientY: toolbarBottom + Math.max(1, window.innerHeight - toolbarBottom) / 2
  };
}
function captureZoomAnchor(clientX, clientY) {
  const fallbackPoint = defaultZoomClientPoint();
  const x = Number.isFinite(clientX) ? Number(clientX) : fallbackPoint.clientX;
  const y = Number.isFinite(clientY) ? Number(clientY) : fallbackPoint.clientY;
  const hit = document.elementFromPoint(x, y);
  const page = (hit instanceof Element ? hit.closest(".page[data-page-number]") : null) || findViewportPage();
  const pageNumber = getPageNumber(page);
  if (!page || !pageNumber) return null;
  const rect = page.getBoundingClientRect();
  return {
    pageNumber,
    xRatio: Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width))),
    yRatio: Math.max(0, Math.min(1, (y - rect.top) / Math.max(1, rect.height))),
    clientX: x,
    clientY: y
  };
}
function restoreZoomAnchor(anchor) {
  if (!anchor) return;
  const page = getPdfPageByNumber(anchor.pageNumber);
  if (!page) return;
  const rect = page.getBoundingClientRect();
  const targetDocumentX = window.scrollX + rect.left + rect.width * anchor.xRatio;
  const targetDocumentY = window.scrollY + rect.top + rect.height * anchor.yRatio;
  window.scrollTo({
    left: Math.max(0, targetDocumentX - anchor.clientX),
    top: Math.max(0, targetDocumentY - anchor.clientY),
    behavior: "auto"
  });
}
function hasTransientZoom() {
  return Math.abs(currentScale - committedScale) >= 1e-3 || Boolean(transientZoomAnchor) || Boolean(viewer.style.transform && viewer.style.transform !== "none");
}
function captureTransientZoomGeometry(anchor) {
  const page = (anchor ? getPdfPageByNumber(anchor.pageNumber) : null) || findViewportPage();
  if (!page) return null;
  const viewerRect = viewer.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const padding = viewerPadding();
  return {
    viewerClientLeft: viewerRect.left,
    viewerClientTop: viewerRect.top,
    pageLeft: pageRect.left - viewerRect.left,
    pageTop: pageRect.top - viewerRect.top,
    pageWidth: pageRect.width,
    pageHeight: pageRect.height,
    availableWidth: Math.max(1, window.innerWidth - padding.left - padding.right)
  };
}
function centeredTransientZoomAnchor(anchor) {
  if (!anchor || !transientZoomCentersHorizontally) return anchor;
  return {
    ...anchor,
    xRatio: 0.5,
    clientX: window.innerWidth / 2
  };
}
function applyTransientZoom(nextScale, anchor) {
  const startsNewGesture = !hasTransientZoom();
  currentScale = clampScale(nextScale);
  if (startsNewGesture) {
    transientZoomAnchor = anchor;
    transientZoomGeometry = captureTransientZoomGeometry(anchor);
  }
  const ratio = currentScale / Math.max(1e-3, committedScale);
  const geometry = transientZoomGeometry;
  if (!geometry || !transientZoomAnchor || Math.abs(ratio - 1) < 1e-3) {
    viewer.style.transformOrigin = "0 0";
    viewer.style.transform = "none";
    return;
  }
  transientZoomCentersHorizontally = geometry.pageWidth * ratio <= geometry.availableWidth + 0.5;
  const horizontalRatio = transientZoomCentersHorizontally ? 0.5 : transientZoomAnchor.xRatio;
  const targetClientX = transientZoomCentersHorizontally ? window.innerWidth / 2 : transientZoomAnchor.clientX;
  const localAnchorX = geometry.pageLeft + geometry.pageWidth * horizontalRatio;
  const localAnchorY = geometry.pageTop + geometry.pageHeight * transientZoomAnchor.yRatio;
  const translateX = targetClientX - geometry.viewerClientLeft - localAnchorX * ratio;
  const translateY = transientZoomAnchor.clientY - geometry.viewerClientTop - localAnchorY * ratio;
  viewer.style.transformOrigin = "0 0";
  viewer.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${ratio})`;
}
function commitTransientZoom() {
  if (!hasTransientZoom()) return;
  const ratio = currentScale / Math.max(1e-3, committedScale);
  const anchor = centeredTransientZoomAnchor(transientZoomAnchor);
  if (Math.abs(ratio - 1) >= 1e-3) {
    for (const pageElement of getPdfPages()) {
      const width = Number.parseFloat(pageElement.style.width || "0") * ratio;
      const height = Number.parseFloat(pageElement.style.height || "0") * ratio;
      if (width > 0) pageElement.style.width = `${width}px`;
      if (height > 0) pageElement.style.height = `${height}px`;
      scaleAnnotationLayerForZoom(pageElement, currentScale);
    }
    committedScale = currentScale;
    viewer.style.setProperty("--scale-factor", String(committedScale));
  }
  viewer.style.transform = "none";
  viewer.style.transformOrigin = "0 0";
  transientZoomAnchor = null;
  transientZoomGeometry = null;
  transientZoomCentersHorizontally = false;
  restoreZoomAnchor(anchor);
}
function canvasOutputScale(viewport) {
  const requested = Math.max(1, Number(window.devicePixelRatio) || 1);
  const dimensionLimit = MAX_CANVAS_DIMENSION / Math.max(1, viewport.width, viewport.height);
  const pixelLimit = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height));
  return Math.min(requested, dimensionLimit, pixelLimit);
}
function parsePixelValue(value) {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}
function viewerPadding() {
  const style = window.getComputedStyle(viewer);
  return {
    left: parsePixelValue(style.paddingLeft),
    right: parsePixelValue(style.paddingRight),
    top: parsePixelValue(style.paddingTop),
    bottom: parsePixelValue(style.paddingBottom)
  };
}
async function computeFitScale(pageNumber = 1) {
  if (!pdfDocument) return DEFAULT_SCALE;
  if (document.hidden || viewer.clientWidth <= 1 || window.innerHeight <= 1) return currentScale || DEFAULT_SCALE;
  const targetPage = Math.max(1, Math.min(Number(pdfDocument.numPages || 1) || 1, Math.floor(Number(pageNumber) || 1)));
  const page = await pdfDocument.getPage(targetPage);
  const viewport = page.getViewport({ scale: 1 });
  const padding = viewerPadding();
  const toolbar = document.querySelector(".onhand-pdf-toolbar");
  const toolbarHeight = toolbar?.getBoundingClientRect().height || 0;
  const availableWidth = Math.max(1, viewer.clientWidth - padding.left - padding.right - 2);
  const availableHeight = Math.max(1, window.innerHeight - toolbarHeight - padding.top - padding.bottom - 2);
  const widthScale = availableWidth / Math.max(1, viewport.width);
  const heightScale = availableHeight / Math.max(1, viewport.height);
  return clampScale(Math.min(widthScale, heightScale));
}
function findViewportPage() {
  const pages = getPdfPages();
  if (!pages.length) return null;
  const viewportMiddle = window.scrollY + window.innerHeight * 0.45;
  let bestPage = pages[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const page of pages) {
    const rect = page.getBoundingClientRect();
    const middle = window.scrollY + rect.top + rect.height / 2;
    const distance = Math.abs(middle - viewportMiddle);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPage = page;
    }
  }
  return bestPage;
}
function pdfTextNodeBoundaryNeedsSpace(previous, next) {
  if (!previous) return false;
  const previousElement = previous.parentElement;
  const nextElement = next.parentElement;
  if (!previousElement || !nextElement || previousElement === nextElement) return false;
  const previousRect = previousElement.getBoundingClientRect();
  const nextRect = nextElement.getBoundingClientRect();
  const lineHeight = Math.max(previousRect.height, nextRect.height);
  if (!lineHeight) {
    return true;
  }
  if (Math.abs(nextRect.top - previousRect.top) > lineHeight / 2) return true;
  return nextRect.left - previousRect.right > lineHeight * 0.12;
}
function buildNormalizedTextMap(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const positions = [];
  let text = "";
  let pendingSpace = null;
  let previousNode = null;
  const searchPositions = [];
  let searchText = "";
  let pendingSearchSpace = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.nodeValue || "";
    if (text && !text.endsWith(" ") && !pendingSpace && pdfTextNodeBoundaryNeedsSpace(previousNode, node)) {
      pendingSpace = { node, offset: 0 };
      if (searchText && !searchText.endsWith(" ") && !pendingSearchSpace) pendingSearchSpace = { node, offset: 0 };
    }
    previousNode = node;
    for (let offset = 0; offset < value.length; offset += 1) {
      const normalized = normalizeSearchChar(value[offset]);
      if (!normalized) continue;
      if (normalized === " ") {
        if (text && !text.endsWith(" ")) pendingSpace = { node, offset };
        if (searchText && !searchText.endsWith(" ")) pendingSearchSpace = { node, offset };
        continue;
      }
      if (pendingSpace) {
        text += " ";
        positions.push(pendingSpace);
        pendingSpace = null;
      }
      for (const char of normalized) {
        text += char;
        positions.push({ node, offset });
        const isSearchable = /[a-z0-9]/i.test(char) || /[^\x00-\x7F]/.test(char);
        if (isSearchable) {
          if (pendingSearchSpace) {
            searchText += " ";
            searchPositions.push(pendingSearchSpace);
            pendingSearchSpace = null;
          }
          searchText += char;
          searchPositions.push({ node, offset });
        } else if (searchText && !searchText.endsWith(" ") && !pendingSearchSpace) {
          pendingSearchSpace = { node, offset };
        }
      }
    }
  }
  return { text, positions, searchText, searchPositions };
}
function normalizeSearchText(value) {
  return buildSearchText(value, true);
}
function compactSearchText(value) {
  return buildSearchText(value, false);
}
function buildSearchText(value, keepSpaces) {
  let text = "";
  let lastWasSpace = false;
  for (const char of String(value || "")) {
    const normalized = normalizeSearchChar(char);
    if (!normalized) continue;
    if (normalized === " ") {
      if (keepSpaces && text && !lastWasSpace) {
        text += " ";
        lastWasSpace = true;
      }
      continue;
    }
    if (!/[a-z0-9]/i.test(normalized) && !/[^\x00-\x7F]/.test(normalized)) {
      if (keepSpaces && text && !lastWasSpace) {
        text += " ";
        lastWasSpace = true;
      }
      continue;
    }
    text += normalized;
    lastWasSpace = false;
  }
  return text.trim();
}
var ANCHOR_CONTEXT_LENGTH = 80;
function collectMatchIndices(haystack, needle) {
  const indices = [];
  if (!needle) return indices;
  let from = 0;
  for (; ; ) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    indices.push(index);
    from = index + Math.max(needle.length, 1);
  }
  return indices;
}
function commonSuffixLength(a, b) {
  let i = a.length - 1;
  let j = b.length - 1;
  let count = 0;
  while (i >= 0 && j >= 0 && a[i] === b[j]) {
    i -= 1;
    j -= 1;
    count += 1;
  }
  return count;
}
function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}
function scoreContextAt(haystack, startIndex, matchLength, compactPrefix, compactSuffix) {
  let score = 0;
  if (compactPrefix) {
    const before = compactSearchText(haystack.slice(Math.max(0, startIndex - ANCHOR_CONTEXT_LENGTH), startIndex));
    score += commonSuffixLength(before, compactPrefix);
  }
  if (compactSuffix) {
    const after = compactSearchText(haystack.slice(startIndex + matchLength, startIndex + matchLength + ANCHOR_CONTEXT_LENGTH));
    score += commonPrefixLength(after, compactSuffix);
  }
  return score;
}
var MIN_CONTEXT_SCORE = 6;
function pickMatchIndex(haystack, indices, matchLength, occurrence, compactPrefix, compactSuffix) {
  if (!indices.length) return -1;
  if (compactPrefix || compactSuffix) {
    const scores = indices.map((index) => scoreContextAt(haystack, index, matchLength, compactPrefix, compactSuffix));
    const bestScore = Math.max(...scores);
    if (bestScore >= MIN_CONTEXT_SCORE) {
      const tied = indices.filter((_, i) => scores[i] === bestScore);
      return tied.length === 1 ? tied[0] : tied[Math.min(Math.max(occurrence, 1), tied.length) - 1];
    }
  }
  return occurrence <= indices.length ? indices[occurrence - 1] : -1;
}
function extractNormalizedContext(haystack, startIndex, matchLength) {
  const prefix = haystack.slice(Math.max(0, startIndex - ANCHOR_CONTEXT_LENGTH), startIndex).trim();
  const suffix = haystack.slice(startIndex + matchLength, startIndex + matchLength + ANCHOR_CONTEXT_LENGTH).trim();
  const context = {};
  if (prefix) context.prefix = prefix;
  if (suffix) context.suffix = suffix;
  return Object.keys(context).length ? context : void 0;
}
function rangeFromMapPositions(positions, startIndex, endIndexInclusive) {
  const start = positions[startIndex];
  const end = positions[endIndexInclusive];
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}
function findMappedTextRange(root, query, occurrence = 1, context) {
  const map = buildNormalizedTextMap(root);
  const queryText = normalizeSearchText(query);
  const compactPrefix = context?.prefix ? compactSearchText(context.prefix) : "";
  const compactSuffix = context?.suffix ? compactSearchText(context.suffix) : "";
  const exactIndices = collectMatchIndices(map.searchText, queryText);
  const exactIndex = pickMatchIndex(map.searchText, exactIndices, queryText.length, occurrence, compactPrefix, compactSuffix);
  if (exactIndex !== -1) {
    const range = rangeFromMapPositions(map.searchPositions, exactIndex, exactIndex + queryText.length - 1);
    if (range) {
      return {
        range,
        matchedText: normalizeText(range.toString()) || normalizeText(query),
        fallback: void 0,
        context: extractNormalizedContext(map.searchText, exactIndex, queryText.length)
      };
    }
  }
  const compactPositions = [];
  let compactText = "";
  for (let index = 0; index < map.text.length; index += 1) {
    const char = map.text[index];
    if (!char || char === " " || !/[a-z0-9]|[^\x00-\x7F]/i.test(char)) continue;
    compactText += char;
    compactPositions.push(index);
  }
  const compactQuery = compactSearchText(query);
  if (compactQuery.length >= 8) {
    const compactIndices = collectMatchIndices(compactText, compactQuery);
    const compactIndex = pickMatchIndex(compactText, compactIndices, compactQuery.length, occurrence, compactPrefix, compactSuffix);
    if (compactIndex !== -1) {
      const startMapIndex = compactPositions[compactIndex];
      const endMapIndex = compactPositions[compactIndex + compactQuery.length - 1];
      const range = rangeFromMapPositions(map.positions, startMapIndex, endMapIndex);
      if (range) {
        return {
          range,
          matchedText: normalizeText(range.toString()) || normalizeText(query),
          fallback: "compact-text",
          context: extractNormalizedContext(map.text, startMapIndex, endMapIndex - startMapIndex + 1)
        };
      }
    }
  }
  if (compactPrefix.length >= 6 && compactSuffix.length >= 6) {
    const maxSpan = Math.max(compactQuery.length * 2, compactQuery.length + 24, 16);
    let best = null;
    for (const prefixIndex of collectMatchIndices(compactText, compactPrefix)) {
      const spanStart = prefixIndex + compactPrefix.length;
      const suffixIndex = compactText.indexOf(compactSuffix, spanStart);
      if (suffixIndex <= spanStart || suffixIndex - spanStart > maxSpan) continue;
      const spanLength = suffixIndex - spanStart;
      if (!best || Math.abs(spanLength - compactQuery.length) < Math.abs(best.spanLength - compactQuery.length)) {
        best = { spanStart, suffixIndex, spanLength };
      }
    }
    if (best) {
      const startMapIndex = compactPositions[best.spanStart];
      const endMapIndex = compactPositions[best.suffixIndex - 1];
      const range = rangeFromMapPositions(map.positions, startMapIndex, endMapIndex);
      if (range) {
        return {
          range,
          matchedText: normalizeText(range.toString()) || normalizeText(query),
          fallback: "context",
          context: extractNormalizedContext(map.text, startMapIndex, endMapIndex - startMapIndex + 1)
        };
      }
    }
  }
  return null;
}
function ensureAnnotationLayer(page) {
  let layer = page.querySelector(".onhand-pdf-annotation-layer");
  if (layer) return layer;
  layer = document.createElement("div");
  layer.className = "onhand-pdf-annotation-layer";
  layer.setAttribute("data-onhand-pdf-coordinate-scale", String(currentScale));
  Object.assign(layer.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: `${page.clientWidth}px`,
    height: `${page.clientHeight}px`,
    transformOrigin: "0 0",
    zIndex: "12",
    pointerEvents: "none"
  });
  page.append(layer);
  return layer;
}
function scaleAnnotationLayerForZoom(page, nextScale) {
  const layer = page.querySelector(".onhand-pdf-annotation-layer");
  if (!layer) return;
  const coordinateScale = Number(layer.getAttribute("data-onhand-pdf-coordinate-scale") || currentScale) || currentScale;
  const ratio = nextScale / Math.max(1e-3, coordinateScale);
  layer.style.transform = Math.abs(ratio - 1) < 1e-3 ? "none" : `scale(${ratio})`;
}
var textMeasureCanvas = null;
function getTextMeasureContext() {
  if (!textMeasureCanvas) textMeasureCanvas = document.createElement("canvas");
  return textMeasureCanvas.getContext("2d");
}
function measureElementText(element, text) {
  const context = getTextMeasureContext();
  if (!context) return 0;
  const style = window.getComputedStyle(element);
  context.font = style.font && style.font !== "" ? style.font : `${style.fontStyle || "normal"} ${style.fontWeight || "400"} ${style.fontSize || "16px"} ${style.fontFamily || "sans-serif"}`;
  return context.measureText(text).width;
}
function rangeIntersectsTextNode(range, node) {
  try {
    return typeof range.intersectsNode === "function" ? range.intersectsNode(node) : true;
  } catch {
    return false;
  }
}
function textSegmentRectsForPage(range, page) {
  const textLayer = page.querySelector(".textLayer, [data-onhand-pdf-text-layer]");
  if (!textLayer) return [];
  const pageRect = page.getBoundingClientRect();
  const size = getPageLayoutSize(page, pageRect);
  const scaleX = pageRect.width ? size.width / pageRect.width : 1;
  const scaleY = pageRect.height ? size.height / pageRect.height : 1;
  const rects = [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!rangeIntersectsTextNode(range, node)) continue;
    const text = node.nodeValue || "";
    const startOffset = node === range.startContainer ? range.startOffset : 0;
    const endOffset = node === range.endContainer ? range.endOffset : text.length;
    if (endOffset <= startOffset) continue;
    const segmentText = text.slice(startOffset, endOffset);
    if (!normalizeText(segmentText)) continue;
    const element = node.parentElement;
    if (!(element instanceof HTMLElement)) continue;
    const spanRect = element.getBoundingClientRect();
    if (!spanRect || spanRect.width <= 0 || spanRect.height <= 0) continue;
    const fullWidth = measureElementText(element, text);
    const segmentWidth = measureElementText(element, segmentText);
    if (!fullWidth || !segmentWidth) continue;
    const prefixWidth = measureElementText(element, text.slice(0, startOffset));
    const left = spanRect.left + prefixWidth / fullWidth * spanRect.width;
    const width = Math.min(spanRect.right, left + segmentWidth / fullWidth * spanRect.width) - left;
    if (width <= 0) continue;
    const rect = clampPdfRectToPageSize({
      left: (left - pageRect.left) * scaleX,
      top: (spanRect.top - pageRect.top) * scaleY,
      width: width * scaleX,
      height: spanRect.height * scaleY
    }, size);
    if (rect) rects.push(rect);
  }
  return rects;
}
function clampPdfRectToPageSize(rect, size) {
  const pageWidth = Math.max(1, Number(size.width) || 1);
  const pageHeight = Math.max(1, Number(size.height) || 1);
  const left = Math.max(0, Math.min(pageWidth, Number(rect.left) || 0));
  const top = Math.max(0, Math.min(pageHeight, Number(rect.top) || 0));
  const right = Math.max(0, Math.min(pageWidth, Number(rect.left + rect.width) || 0));
  const bottom = Math.max(0, Math.min(pageHeight, Number(rect.top + rect.height) || 0));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0.5 || height <= 0.5) return null;
  return { left, top, width, height };
}
function rangeRectsForPage(range, page) {
  const textSegmentRects = textSegmentRectsForPage(range, page);
  if (textSegmentRects.length) return textSegmentRects;
  const pageRect = page.getBoundingClientRect();
  const size = getPageLayoutSize(page, pageRect);
  const scaleX = pageRect.width ? size.width / pageRect.width : 1;
  const scaleY = pageRect.height ? size.height / pageRect.height : 1;
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({
    left: (rect.left - pageRect.left) * scaleX,
    top: (rect.top - pageRect.top) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  })).map((rect) => clampPdfRectToPageSize(rect, size)).filter((rect) => Boolean(rect));
}
function unionRects(rects) {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  return { left, top, width: right - left, height: bottom - top };
}
function applyHighlightStyles(highlight, rects, union) {
  highlight.setAttribute("data-onhand-pdf-highlight-container", "true");
  highlight.setAttribute("data-onhand-theme", PDF_VIEWER_ANNOTATION_THEME);
  makePdfHighlightPassive(highlight);
  Object.assign(highlight.style, {
    position: "absolute",
    left: `${union.left}px`,
    top: `${union.top}px`,
    width: `${union.width}px`,
    height: `${union.height}px`,
    pointerEvents: "none",
    cursor: "default",
    userSelect: "none",
    // Highlights and note cards share one annotation layer, so paint
    // order would otherwise follow DOM order — a highlight added after
    // a card would cover it. Pin highlights below cards explicitly.
    zIndex: "1",
    scrollMarginTop: "22vh",
    scrollMarginBottom: "22vh"
  });
  for (const rect of rects) {
    const segment = document.createElement("div");
    segment.setAttribute("data-onhand-pdf-highlight-segment", "true");
    segment.setAttribute("data-onhand-theme", PDF_VIEWER_ANNOTATION_THEME);
    makePdfHighlightPassive(segment);
    Object.assign(segment.style, {
      position: "absolute",
      left: `${rect.left - union.left}px`,
      top: `${rect.top - union.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      background: "rgba(234, 157, 52, 0.34)",
      borderRadius: "2px"
    });
    highlight.append(segment);
  }
  highlight.style.setProperty("background", "transparent", "important");
  highlight.style.setProperty("border-radius", "0", "important");
  highlight.style.setProperty("pointer-events", "none", "important");
  highlight.style.setProperty("cursor", "default", "important");
  highlight.style.setProperty("user-select", "none", "important");
  highlight.style.setProperty("-webkit-user-select", "none", "important");
}
function makePdfHighlightPassive(element) {
  element.removeAttribute("role");
  element.removeAttribute("tabindex");
  element.removeAttribute("title");
  element.removeAttribute("data-onhand-note-trigger-bound");
  element.setAttribute("aria-hidden", "true");
  element.style.setProperty("pointer-events", "none", "important");
  element.style.setProperty("cursor", "default", "important");
  element.style.setProperty("user-select", "none", "important");
  element.style.setProperty("-webkit-user-select", "none", "important");
}
function buildAnnotationResult(annotation, rawQuery = "", extra = {}) {
  const page = annotation.closest(".page[data-page-number]");
  return {
    annotationId: annotation.getAttribute("data-onhand-annotation-id") || "",
    kind: annotation.getAttribute("data-onhand-highlight-kind") || "pdf",
    matchedText: normalizeText(annotation.getAttribute("data-onhand-matched-text") || rawQuery).slice(0, 500),
    container: {
      tag: "pdf-page",
      text: page ? `Page ${getPageNumber(page) || "?"}` : "PDF page",
      pageNumber: getPageNumber(page)
    },
    rect: rectToObject(annotation.getBoundingClientRect()),
    scrollY: window.scrollY,
    pdfAnchor: parsePdfAnchor(annotation),
    ...extra
  };
}
function parsePdfAnchor(annotation) {
  if (!(annotation instanceof Element)) return null;
  try {
    return JSON.parse(annotation.getAttribute("data-onhand-pdf-anchor") || "null");
  } catch {
    return null;
  }
}
function pdfAnchorText(anchor, fallback = "") {
  return compactSearchText(anchor?.matchedText || anchor?.textQuote?.exact || fallback || "");
}
function pdfAnchorPageNumber(anchor) {
  const pageNumber = Number(anchor?.pageNumber || anchor?.rects?.find?.((rect) => Number(rect?.pageNumber) > 0)?.pageNumber || "");
  return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null;
}
function pdfDocumentUrl(anchor) {
  return String(anchor?.document?.pdfUrl || anchor?.document?.url || "").trim();
}
function pdfHighlightMatches(annotation, rawQuery, options = {}, occurrence = 1) {
  const targetAnchor = options.pdfAnchor;
  const existingAnchor = parsePdfAnchor(annotation);
  const targetPage = pdfAnchorPageNumber(targetAnchor);
  const existingPage = pdfAnchorPageNumber(existingAnchor) || getPageNumber(annotation.closest(".page[data-page-number]"));
  if (targetPage && existingPage && targetPage !== existingPage) return false;
  const targetUrl = pdfDocumentUrl(targetAnchor);
  const existingUrl = pdfDocumentUrl(existingAnchor);
  if (targetUrl && existingUrl && targetUrl !== existingUrl) return false;
  const targetText = pdfAnchorText(targetAnchor, rawQuery);
  const existingText = pdfAnchorText(existingAnchor, annotation.getAttribute("data-onhand-matched-text") || "");
  if (targetText && existingText && targetText !== existingText && !targetText.includes(existingText) && !existingText.includes(targetText)) return false;
  const targetOccurrence = Number(targetAnchor?.occurrence || options.occurrence || occurrence || 1);
  const existingOccurrence = Number(existingAnchor?.occurrence || 1);
  if (Number.isFinite(targetOccurrence) && Number.isFinite(existingOccurrence) && targetOccurrence > 0 && existingOccurrence > 0 && targetOccurrence !== existingOccurrence) {
    return false;
  }
  return Boolean(targetText || existingText);
}
function findExistingPdfHighlight(rawQuery, options = {}, occurrence = 1) {
  for (const annotation of Array.from(document.querySelectorAll("[data-onhand-highlight-kind='pdf']"))) {
    if (pdfHighlightMatches(annotation, rawQuery, options, occurrence)) return annotation;
  }
  return null;
}
function removeDuplicatePdfHighlights(keeper, rawQuery, options = {}, occurrence = 1) {
  let removed = 0;
  for (const annotation of Array.from(document.querySelectorAll("[data-onhand-highlight-kind='pdf']"))) {
    if (annotation === keeper || !pdfHighlightMatches(annotation, rawQuery, options, occurrence)) continue;
    const annotationId = annotation.getAttribute("data-onhand-annotation-id") || "";
    if (annotationId) removeNotesForAnnotation(annotationId);
    annotation.remove();
    removed += 1;
  }
  return removed;
}
function normalizePdfRegionRect(value) {
  if (!value || typeof value !== "object") return null;
  const left = Number(value.left);
  const top = Number(value.top);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![left, top, width, height].every((entry) => Number.isFinite(entry))) return null;
  if (left < 0 || top < 0 || width <= 0 || height <= 0 || left >= 1 || top >= 1) return null;
  const clampedLeft = Math.max(0, Math.min(0.98, left));
  const clampedTop = Math.max(0, Math.min(0.98, top));
  return {
    left: clampedLeft,
    top: clampedTop,
    width: Math.max(0.02, Math.min(1 - clampedLeft, width)),
    height: Math.max(0.01, Math.min(1 - clampedTop, height))
  };
}
async function pdfHighlightRegion(label, regionRect, options = {}) {
  const pageNumber = pdfAnchorPageNumber(options.pdfAnchor);
  if (!pageNumber) throw new Error("A region highlight requires pdfAnchor.pageNumber.");
  await ensurePageRendered(pageNumber, renderSequence, { sharpen: false });
  const page = getPdfPageByNumber(pageNumber);
  if (!page) throw new Error(`PDF page not found: ${pageNumber}`);
  const pageText = normalizeText(isPendingPage(page) ? await getPageTextContent(pageNumber) : pdfPageText(page));
  if (pageText.length >= 40) throw new Error("This page has extractable text; anchor with an exact text quote instead of a region.");
  const size = { width: page.clientWidth || 1, height: page.clientHeight || 1 };
  const rect = clampPdfRectToPageSize(
    {
      left: regionRect.left * size.width,
      top: regionRect.top * size.height,
      width: regionRect.width * size.width,
      height: regionRect.height * size.height
    },
    size
  );
  if (!rect) throw new Error("Region rect resolved outside the page bounds.");
  const annotationId = nextAnnotationId();
  const pdfAnchor = {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    document: { url: sourceUrl, title: document.title },
    pageNumber,
    matchedText: label,
    textQuote: { exact: label },
    regionRect,
    rects: [rect],
    occurrence: 1,
    region: true
  };
  const highlight = document.createElement("div");
  highlight.setAttribute("data-onhand-highlight-kind", "pdf");
  highlight.setAttribute("data-onhand-region", "true");
  highlight.setAttribute("data-onhand-annotation-id", annotationId);
  highlight.setAttribute("data-onhand-matched-text", label);
  highlight.setAttribute("data-onhand-pdf-anchor", JSON.stringify(pdfAnchor));
  applyHighlightStyles(highlight, [rect], rect);
  ensureAnnotationLayer(page).append(highlight);
  if (options.scrollIntoView !== false) {
    highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    await waitForNextFrame();
    updatePageFromScroll();
  }
  return buildAnnotationResult(highlight, label, { region: true });
}
async function pdfHighlightText(query, options = {}) {
  const rawQuery = String(query || "").trim();
  if (!rawQuery) throw new Error("highlightText requires a non-empty query");
  if (options.clearExisting === true) pdfClearAnnotations();
  const occurrence = Math.max(1, Math.min(20, Number(options.occurrence || 1) || 1));
  if (options.clearExisting !== true && options.reuseExisting === true) {
    const existing = findExistingPdfHighlight(rawQuery, options, occurrence);
    if (existing) {
      const duplicateCount = removeDuplicatePdfHighlights(existing, rawQuery, options, occurrence);
      if (options.scrollIntoView !== false) {
        existing.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
        await waitForNextFrame();
        updatePageFromScroll();
      }
      return buildAnnotationResult(existing, rawQuery, {
        reusedExisting: true,
        ...duplicateCount ? { duplicateCount } : {}
      });
    }
  }
  const regionRect = normalizePdfRegionRect(options.pdfAnchor?.regionRect);
  if (regionRect) return await pdfHighlightRegion(rawQuery, regionRect, options);
  const targetPageNumber = pdfAnchorPageNumber(options.pdfAnchor);
  if (targetPageNumber) await ensurePageRendered(targetPageNumber);
  async function applyHighlightToPage(page) {
    const textLayer = page.querySelector(".textLayer");
    if (!textLayer) return null;
    const match = findMappedTextRange(textLayer, rawQuery, occurrence, options.pdfAnchor?.textQuote);
    if (!match) return null;
    const rects = rangeRectsForPage(match.range, page);
    if (!rects.length) return null;
    const union = unionRects(rects);
    const annotationId = nextAnnotationId();
    const pdfAnchor = {
      surface: "pdf",
      viewer: "onhand-pdf-viewer",
      document: { url: sourceUrl, title: document.title },
      pageNumber: getPageNumber(page),
      matchedText: match.matchedText,
      textQuote: {
        exact: match.matchedText,
        ...match.context?.prefix ? { prefix: match.context.prefix } : {},
        ...match.context?.suffix ? { suffix: match.context.suffix } : {}
      },
      rects,
      occurrence,
      fallback: match.fallback
    };
    const highlight = document.createElement("div");
    highlight.setAttribute("data-onhand-highlight-kind", "pdf");
    highlight.setAttribute("data-onhand-annotation-id", annotationId);
    highlight.setAttribute("data-onhand-matched-text", match.matchedText);
    highlight.setAttribute("data-onhand-pdf-anchor", JSON.stringify(pdfAnchor));
    applyHighlightStyles(highlight, rects, union);
    ensureAnnotationLayer(page).append(highlight);
    if (options.scrollIntoView !== false) {
      highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
      await waitForNextFrame();
      updatePageFromScroll();
    }
    return buildAnnotationResult(highlight, rawQuery, { approximate: Boolean(match.fallback), fallback: match.fallback });
  }
  const pages = getPdfPages().map((page, index) => {
    const rect = page.getBoundingClientRect();
    const pageNumber = getPageNumber(page);
    return {
      page,
      index,
      targeted: Boolean(targetPageNumber && pageNumber === targetPageNumber),
      visible: visibleEnough(rect),
      distance: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2)
    };
  }).sort((a, b) => {
    if (a.targeted !== b.targeted) return a.targeted ? -1 : 1;
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    if (a.visible && b.visible && a.distance !== b.distance) return a.distance - b.distance;
    return a.index - b.index;
  });
  for (const { page } of pages) {
    const result = await applyHighlightToPage(page);
    if (result) return result;
  }
  const pendingPageNumber = await findPendingPageWithText(rawQuery);
  if (pendingPageNumber) {
    await ensurePageRendered(pendingPageNumber);
    const pendingPage = getPdfPageByNumber(pendingPageNumber);
    if (pendingPage) {
      const result = await applyHighlightToPage(pendingPage);
      if (result) return result;
    }
  }
  throw new Error(`No visible text matched: ${rawQuery}`);
}
function findAnnotation(annotationId) {
  const escaped = CSS.escape(annotationId);
  const annotation = document.querySelector(`[data-onhand-annotation-id="${escaped}"]`);
  if (!annotation) throw new Error(`Annotation not found: ${annotationId}`);
  return annotation;
}
function removeNotesForAnnotation(annotationId) {
  let count = 0;
  for (const note of Array.from(document.querySelectorAll(`[data-onhand-note-for="${CSS.escape(annotationId)}"]`))) {
    note.remove();
    count += 1;
  }
  return count;
}
function findNoteForAnnotation(annotationId) {
  return document.querySelector(`[data-onhand-note-for="${CSS.escape(annotationId)}"]`);
}
function setImportantStyle(element, property, value) {
  element.style.setProperty(property, value, "important");
}
function setImportantStyles(element, styles) {
  for (const [property, value] of Object.entries(styles)) {
    setImportantStyle(element, property, value);
  }
}
function getPageLayoutSize(page, pageRect = page.getBoundingClientRect()) {
  const width = Number(page.clientWidth || page.offsetWidth || pageRect.width || 1) || 1;
  const height = Number(page.clientHeight || page.offsetHeight || pageRect.height || 1) || 1;
  return {
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}
function toPageRect(rect, page, pageRect) {
  const size = getPageLayoutSize(page, pageRect);
  const scaleX = pageRect.width ? size.width / pageRect.width : 1;
  const scaleY = pageRect.height ? size.height / pageRect.height : 1;
  const left = (rect.left - pageRect.left) * scaleX;
  const top = (rect.top - pageRect.top) * scaleY;
  const width = rect.width * scaleX;
  const height = rect.height * scaleY;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  };
}
function rectOverlapArea(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}
function getPdfTextRects(page, pageRect) {
  return Array.from(page.querySelectorAll(".textLayer span, [data-onhand-pdf-text-layer] span")).map((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return toPageRect(rect, page, pageRect);
  }).filter((rect) => Boolean(rect));
}
function scorePdfNoteCandidate(candidate, textRects, anchorRect, noteRects = []) {
  const candidateArea = Math.max(1, candidate.width * candidate.height);
  const anchorArea = Math.max(1, anchorRect.width * anchorRect.height);
  const textOverlap = textRects.reduce((sum, rect) => sum + rectOverlapArea(candidate, rect), 0) / candidateArea;
  const anchorOverlap = rectOverlapArea(candidate, anchorRect) / anchorArea;
  const noteOverlap = noteRects.reduce((sum, rect) => sum + rectOverlapArea(candidate, rect), 0) / candidateArea;
  const anchorDistance = Math.abs(candidate.left - anchorRect.left) + Math.abs(candidate.top - anchorRect.top);
  return textOverlap * 800 + anchorOverlap * 1600 + noteOverlap * 6e3 + anchorDistance + candidate.order * 4;
}
function collectOtherPdfNoteRects(note, page, pageRect) {
  const overlay = page.querySelector(".onhand-pdf-annotation-layer");
  if (!overlay) return [];
  return Array.from(overlay.querySelectorAll("[data-onhand-pdf-note]")).filter((element) => element !== note).map((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return toPageRect(rect, page, pageRect);
  }).filter((rect) => Boolean(rect));
}
function choosePdfNotePosition(page, pageRect, anchorRect, noteWidth, noteHeight, noteRects = []) {
  const { width: pageWidth, height: pageHeight } = getPageLayoutSize(page, pageRect);
  const margin = Math.max(12, Math.min(20, pageWidth * 0.025));
  const gap = Math.max(10, Math.min(18, pageHeight * 0.018));
  const clamp = (value, min, max) => {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
  };
  const maxLeft = Math.max(margin, pageWidth - noteWidth - margin);
  const maxTop = Math.max(margin, pageHeight - noteHeight - margin);
  const rightOfAnchor = clamp(anchorRect.right + gap, margin, maxLeft);
  const leftOfAnchor = clamp(anchorRect.left - noteWidth - gap, margin, maxLeft);
  const alignedWithAnchor = clamp(anchorRect.left, margin, maxLeft);
  const rightEdge = maxLeft;
  const leftEdge = margin;
  const aboveAnchor = anchorRect.top - noteHeight - gap;
  const belowAnchor = anchorRect.bottom + gap;
  const alignedTop = anchorRect.top;
  const candidates = [
    [rightOfAnchor, belowAnchor],
    [alignedWithAnchor, belowAnchor],
    [rightOfAnchor, aboveAnchor],
    [alignedWithAnchor, aboveAnchor],
    [leftOfAnchor, belowAnchor],
    [leftOfAnchor, aboveAnchor],
    [rightOfAnchor, alignedTop],
    [leftOfAnchor, alignedTop],
    [rightEdge, alignedTop],
    [leftEdge, alignedTop],
    [rightEdge, belowAnchor],
    [rightEdge, aboveAnchor],
    [rightEdge, margin],
    [rightEdge, maxTop],
    [leftEdge, maxTop]
  ].map(([left, top], order) => ({
    left: clamp(left, margin, maxLeft),
    top: clamp(top, margin, maxTop),
    right: clamp(left, margin, maxLeft) + noteWidth,
    bottom: clamp(top, margin, maxTop) + noteHeight,
    width: noteWidth,
    height: noteHeight,
    order
  }));
  const textRects = getPdfTextRects(page, pageRect);
  return candidates.reduce((best, candidate) => {
    const score = scorePdfNoteCandidate(candidate, textRects, anchorRect, noteRects);
    return !best || score < best.score ? { ...candidate, score } : best;
  }, null);
}
function setPdfNoteCollapsed(note, collapsed) {
  const body = note.querySelector("[data-onhand-note-part='body']");
  const label = note.querySelector("[data-onhand-note-part='label']");
  const toggle = note.querySelector("[data-onhand-note-toggle]");
  note.setAttribute("data-onhand-note-collapsed", collapsed ? "true" : "false");
  if (body) body.hidden = collapsed;
  if (label) label.hidden = collapsed;
  if (toggle) {
    toggle.textContent = collapsed ? "+" : "x";
    toggle.setAttribute("aria-label", collapsed ? "Expand note" : "Collapse note");
    toggle.setAttribute("title", collapsed ? "Expand note" : "Collapse note");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
  if (collapsed) {
    setImportantStyle(note, "width", "30px");
    setImportantStyle(note, "inline-size", "30px");
    setImportantStyle(note, "min-width", "0");
    setImportantStyle(note, "max-width", "30px");
    setImportantStyle(note, "height", "30px");
    setImportantStyle(note, "min-height", "30px");
    setImportantStyle(note, "padding", "0");
    setImportantStyle(note, "overflow", "hidden");
    setImportantStyle(note, "display", "flex");
    setImportantStyle(note, "align-items", "center");
    setImportantStyle(note, "justify-content", "center");
    setImportantStyle(note, "cursor", "pointer");
    setImportantStyle(note, "border-radius", "4px");
    setImportantStyle(note, "opacity", "0.48");
    return;
  }
  for (const property of [
    "width",
    "inline-size",
    "min-width",
    "max-width",
    "height",
    "min-height",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "overflow",
    "display",
    "align-items",
    "justify-content",
    "cursor",
    "border-radius",
    "opacity"
  ]) {
    note.style.removeProperty(property);
  }
}
function positionPdfNote(note, annotation, page) {
  const wasCollapsed = note.getAttribute("data-onhand-note-collapsed") === "true";
  if (!wasCollapsed) setPdfNoteCollapsed(note, false);
  const annotationRect = annotation.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const pageSize = getPageLayoutSize(page, pageRect);
  const maxWidth = Math.min(420, Math.max(220, pageSize.width - 32));
  setImportantStyles(note, {
    position: "absolute",
    "max-width": `${maxWidth}px`,
    "min-width": "220px",
    "min-height": "76px",
    "box-sizing": "border-box",
    padding: "12px 14px",
    background: "#e6dbd1",
    color: "#575279",
    border: "1px solid #cac1b9",
    "border-left": "3px solid #286983",
    "border-radius": "0 4px 4px 0",
    "box-shadow": "0 1px 3px rgba(47, 44, 40, 0.16)",
    font: '15px/1.55 "New York", "Iowan Old Style", Charter, Georgia, serif',
    "pointer-events": "auto",
    // Cards sit above highlights (z-index 1) in the shared layer.
    "z-index": "4",
    "scroll-margin-top": "22vh",
    "scroll-margin-bottom": "22vh"
  });
  const measuredRect = note.getBoundingClientRect();
  const measuredHeight = measuredRect.height || note.offsetHeight || 0;
  const noteHeight = wasCollapsed ? 30 : Math.max(76, Math.min(240, measuredHeight || 96));
  const noteWidth = Math.max(220, Math.min(maxWidth, measuredRect.width || maxWidth));
  const otherNoteRects = collectOtherPdfNoteRects(note, page, pageRect);
  const positioned = choosePdfNotePosition(page, pageRect, toPageRect(annotationRect, page, pageRect), noteWidth, noteHeight, otherNoteRects);
  if (positioned) {
    setImportantStyle(note, "left", `${positioned.left}px`);
    setImportantStyle(note, "top", `${positioned.top}px`);
  }
  if (wasCollapsed) setPdfNoteCollapsed(note, true);
}
function expandPdfNoteForAnnotation(annotationId) {
  const note = findNoteForAnnotation(annotationId);
  if (!note) return null;
  setPdfNoteCollapsed(note, false);
  try {
    const annotation = findAnnotation(annotationId);
    const page = annotation.closest(".page[data-page-number]");
    if (page) positionPdfNote(note, annotation, page);
  } catch {
  }
  return note;
}
function attachPdfNoteInteractions(note, annotation) {
  const annotationId = String(note.getAttribute("data-onhand-note-for") || annotation.getAttribute("data-onhand-annotation-id") || "");
  if (!annotationId) return;
  makePdfHighlightPassive(annotation);
  if (note.hasAttribute("data-onhand-note-toggle-bound")) return;
  note.setAttribute("data-onhand-note-toggle-bound", "true");
  const toggle = note.querySelector("[data-onhand-note-toggle]");
  toggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextCollapsed = note.getAttribute("data-onhand-note-collapsed") !== "true";
    setPdfNoteCollapsed(note, nextCollapsed);
    if (!nextCollapsed) expandPdfNoteForAnnotation(annotationId);
  });
  note.addEventListener("click", (event) => {
    if (note.getAttribute("data-onhand-note-collapsed") !== "true") return;
    event.preventDefault();
    expandPdfNoteForAnnotation(annotationId);
  });
}
async function pdfShowNote(annotationId, noteText, options = {}) {
  const rawAnnotationId = String(annotationId || "").trim();
  const rawNoteText = String(noteText || "").trim();
  if (!rawAnnotationId) throw new Error("showNote requires a non-empty annotationId");
  if (!rawNoteText) throw new Error("showNote requires non-empty note text");
  const annotation = findAnnotation(rawAnnotationId);
  const page = annotation.closest(".page[data-page-number]");
  if (!page) throw new Error(`PDF annotation page not found for id: ${rawAnnotationId}`);
  const overlay = ensureAnnotationLayer(page);
  const replacedCount = removeNotesForAnnotation(rawAnnotationId);
  const noteId = nextAnnotationId();
  const note = document.createElement("div");
  note.setAttribute("data-onhand-note-kind", "card");
  note.setAttribute("data-onhand-theme", PDF_VIEWER_ANNOTATION_THEME);
  note.setAttribute("data-onhand-pdf-note", "true");
  note.setAttribute("data-onhand-note-id", noteId);
  note.setAttribute("data-onhand-note-for", rawAnnotationId);
  const header = document.createElement("div");
  header.setAttribute("data-onhand-note-part", "header");
  const label = document.createElement("span");
  label.setAttribute("data-onhand-note-part", "label");
  label.textContent = String(options.label || "Onhand");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.setAttribute("data-onhand-note-toggle", "true");
  toggle.textContent = "x";
  const body = document.createElement("div");
  body.setAttribute("data-onhand-note-part", "body");
  body.setAttribute("data-onhand-note-source", rawNoteText);
  body.textContent = rawNoteText;
  header.append(label, toggle);
  note.append(header, body);
  Object.assign(label.style, {
    font: "700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#286983"
  });
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    marginBottom: "6px"
  });
  Object.assign(toggle.style, {
    width: "22px",
    height: "22px",
    border: "1px solid #cac1b9",
    borderRadius: "3px",
    background: "rgba(255, 255, 255, 0.35)",
    color: "#286983",
    cursor: "pointer",
    font: "700 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    padding: "0"
  });
  setPdfNoteCollapsed(note, false);
  attachPdfNoteInteractions(note, annotation);
  overlay.append(note);
  positionPdfNote(note, annotation, page);
  if (options.scrollIntoView !== false) {
    note.scrollIntoView({ behavior: "auto", block: options.block || "center", inline: "nearest" });
    await waitForNextFrame();
    positionPdfNote(note, annotation, page);
    updatePageFromScroll();
  }
  return {
    noteId,
    annotationId: rawAnnotationId,
    text: rawNoteText.slice(0, 500),
    replacedCount,
    container: { tag: "pdf-page", text: `Page ${getPageNumber(page) || "?"}`, pageNumber: getPageNumber(page) },
    insertionTarget: { tag: "pdf-overlay" },
    insertionPosition: "pdf-overlay",
    anchorRect: rectToObject(annotation.getBoundingClientRect()),
    rect: rectToObject(note.getBoundingClientRect()),
    scrollY: window.scrollY,
    pdfAnchor: parsePdfAnchor(annotation)
  };
}
async function pdfScrollToAnnotation(annotationId, options = {}) {
  const annotation = findAnnotation(String(annotationId || "").trim());
  const note = findNoteForAnnotation(annotationId);
  if (options.target === "note" && note) expandPdfNoteForAnnotation(annotationId);
  const target = options.target === "note" && note ? note : annotation;
  target.scrollIntoView({ behavior: "auto", block: options.block || "center", inline: "nearest" });
  await waitForNextFrame();
  updatePageFromScroll();
  return buildAnnotationResult(annotation);
}
function pdfClearAnnotations() {
  const highlights = Array.from(document.querySelectorAll("[data-onhand-highlight-kind='pdf']"));
  const notes = Array.from(document.querySelectorAll("[data-onhand-note-kind='card']"));
  for (const element of [...highlights, ...notes]) element.remove();
  return { clearedPdf: highlights.length, clearedNotes: notes.length, cleared: highlights.length + notes.length };
}
function pdfRemoveAnnotations(annotationIds) {
  const ids = Array.from(
    new Set(
      (Array.isArray(annotationIds) ? annotationIds : [annotationIds]).map((id) => String(id || "").trim()).filter(Boolean)
    )
  );
  let removedCount = 0;
  for (const annotationId of ids) {
    const elements = Array.from(document.querySelectorAll(`[data-onhand-annotation-id="${CSS.escape(annotationId)}"]`));
    if (!elements.length) continue;
    for (const element of elements) element.remove();
    removeNotesForAnnotation(annotationId);
    removedCount += 1;
  }
  if (!removedCount) throw new Error(`No annotation found with id: ${ids.join(", ") || "(blank)"}`);
  return { removedCount, requestedCount: ids.length };
}
function capturePdfAnnotationSnapshots() {
  return Array.from(document.querySelectorAll("[data-onhand-highlight-kind='pdf']")).map((annotation) => {
    const annotationId = annotation.getAttribute("data-onhand-annotation-id") || "";
    const pdfAnchor = parsePdfAnchor(annotation);
    const note = annotationId ? findNoteForAnnotation(annotationId) : null;
    const body = note?.querySelector("[data-onhand-note-part='body']");
    const label = note?.querySelector("[data-onhand-note-part='label']");
    const text = pdfAnchorText(pdfAnchor, annotation.getAttribute("data-onhand-matched-text") || "");
    return {
      annotationId,
      text,
      occurrence: Math.max(1, Math.min(100, Number(pdfAnchor?.occurrence || 1) || 1)),
      pdfAnchor,
      note: note && body ? {
        text: normalizeText(body.getAttribute("data-onhand-note-source") || body.textContent || ""),
        label: normalizeText(label?.textContent || "") || "Onhand",
        collapsed: note.getAttribute("data-onhand-note-collapsed") === "true"
      } : null
    };
  }).filter((snapshot) => Boolean(snapshot.text));
}
function capturePdfViewSnapshot() {
  const page = findViewportPage() || getPdfPageByNumber(Number(pageInput.value || 1));
  const pageNumber = getPageNumber(page) || Number(pageInput.value || 1) || 1;
  let pageOffsetRatio = 0;
  if (page) {
    const rect = page.getBoundingClientRect();
    const pageTop = window.scrollY + rect.top;
    pageOffsetRatio = Math.max(0, Math.min(1, (window.scrollY - pageTop) / Math.max(1, rect.height)));
  }
  return {
    pageNumber,
    pageOffsetRatio,
    annotations: capturePdfAnnotationSnapshots()
  };
}
async function restorePdfAnnotationSnapshots(annotations, sequence) {
  for (const snapshot of annotations) {
    if (sequence !== renderSequence) return;
    try {
      const highlighted = await pdfHighlightText(snapshot.text, {
        pdfAnchor: snapshot.pdfAnchor,
        occurrence: snapshot.occurrence,
        scrollIntoView: false,
        reuseExisting: true
      });
      if (sequence !== renderSequence) return;
      if (snapshot.note?.text && highlighted.annotationId) {
        await pdfShowNote(highlighted.annotationId, snapshot.note.text, {
          label: snapshot.note.label || "Onhand",
          scrollIntoView: false
        });
        const restoredNote = findNoteForAnnotation(highlighted.annotationId);
        if (restoredNote && snapshot.note.collapsed) setPdfNoteCollapsed(restoredNote, true);
      }
    } catch {
    }
  }
}
async function rebuildPdfAnnotationLayers(annotations, sequence) {
  if (!annotations.length) return;
  for (const layer of Array.from(document.querySelectorAll(".onhand-pdf-annotation-layer"))) layer.remove();
  await restorePdfAnnotationSnapshots(annotations, sequence);
}
async function restorePdfViewSnapshot(snapshot, sequence) {
  if (!snapshot) {
    updatePageFromScroll();
    return;
  }
  await restorePdfAnnotationSnapshots(snapshot.annotations, sequence);
  if (sequence !== renderSequence) return;
  const page = getPdfPageByNumber(snapshot.pageNumber);
  if (page) {
    const rect = page.getBoundingClientRect();
    const pageTop = window.scrollY + rect.top;
    window.scrollTo({ top: Math.max(0, pageTop + rect.height * snapshot.pageOffsetRatio), left: 0, behavior: "auto" });
    setCurrentPageNumber(snapshot.pageNumber);
    await waitForNextFrame();
  }
  updatePageFromScroll();
}
function pdfGetVisibleText(options = {}) {
  const maxBlocks = Math.max(1, Math.min(80, Number(options.maxBlocks || 25) || 25));
  const maxChars = Math.max(200, Math.min(2e4, Number(options.maxChars || 6e3) || 6e3));
  const blocks = [];
  let totalChars = 0;
  for (const page of getPdfPages()) {
    const rect = page.getBoundingClientRect();
    if (!visibleEnough(rect)) continue;
    const pageNumber = getPageNumber(page);
    const text2 = pdfPageText(page);
    if (!text2) continue;
    const clipped = text2.slice(0, Math.max(0, maxChars - totalChars));
    totalChars += clipped.length;
    blocks.push({
      tag: "pdf-page",
      selector: `.page[data-page-number="${pageNumber || ""}"]`,
      text: clipped,
      rect: rectToObject(rect),
      pageNumber
    });
    if (blocks.length >= maxBlocks || totalChars >= maxChars) break;
  }
  const text = blocks.map((block) => block.pageNumber ? `[p. ${block.pageNumber}] ${block.text}` : block.text).join("\n\n").slice(0, maxChars);
  return {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    url: sourceUrl,
    title: document.title,
    text,
    blocks,
    viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY }
  };
}
function textLayerVisibleText(textLayer) {
  if (!textLayer) return "";
  const clone = textLayer.cloneNode(true);
  clone.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith("\n"));
  return normalizeText(clone.textContent || "");
}
function pdfPageText(page) {
  if (!page) return "";
  const textLayer = page.querySelector(".textLayer");
  if (textLayer) return textLayerVisibleText(textLayer);
  return normalizeText(page.textContent || "");
}
function buildPdfAnchor(page, match, occurrence = 1) {
  const rects = rangeRectsForPage(match.range, page);
  return {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    document: { url: sourceUrl, title: document.title },
    pageNumber: getPageNumber(page),
    matchedText: match.matchedText,
    textQuote: {
      exact: match.matchedText,
      ...match.context?.prefix ? { prefix: match.context.prefix } : {},
      ...match.context?.suffix ? { suffix: match.context.suffix } : {}
    },
    rects,
    occurrence,
    fallback: match.fallback
  };
}
function getPdfPageForNode(node) {
  const element = node instanceof Element ? node : node?.parentElement || null;
  return element?.closest?.(".page[data-page-number]");
}
function rectIntersectionArea(a, b) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}
function rangeIntersectsPage(range, page) {
  const textLayer = page.querySelector(".textLayer, [data-onhand-pdf-text-layer]") || page;
  try {
    if (typeof range.intersectsNode === "function" && range.intersectsNode(textLayer)) return true;
  } catch {
  }
  const rangeRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rangeRects.length) return false;
  const pageRect = page.getBoundingClientRect();
  return rangeRects.some((rect) => rectIntersectionArea(rect, pageRect) > 0);
}
function buildTextQuoteForSelection(page, matchedText) {
  const textQuote = { exact: matchedText };
  const pageText = pdfPageText(page);
  const lowerPageText = pageText.toLowerCase();
  const lowerMatchedText = matchedText.toLowerCase();
  const index = lowerMatchedText ? lowerPageText.indexOf(lowerMatchedText) : -1;
  if (index > 0) textQuote.prefix = pageText.slice(Math.max(0, index - ANCHOR_CONTEXT_LENGTH), index).trim();
  if (index >= 0) textQuote.suffix = pageText.slice(index + matchedText.length, index + matchedText.length + ANCHOR_CONTEXT_LENGTH).trim();
  return textQuote;
}
function buildPdfAnchorForSelection(range, matchedText) {
  const startPage = getPdfPageForNode(range.startContainer);
  const endPage = getPdfPageForNode(range.endContainer);
  const commonPage = getPdfPageForNode(range.commonAncestorContainer);
  const entries = getPdfPages().filter((page) => page === startPage || page === endPage || page === commonPage || rangeIntersectsPage(range, page)).map((page) => {
    const pageNumber = getPageNumber(page);
    const rects2 = rangeRectsForPage(range, page).filter((rect) => rect.width > 0 && rect.height > 0);
    return pageNumber && rects2.length ? { page, pageNumber, rects: rects2 } : null;
  }).filter(Boolean);
  if (!entries.length) return null;
  const primary = entries[0];
  const rects = entries.flatMap((entry) => entry.rects.map((rect) => ({ ...rect, pageNumber: entry.pageNumber })));
  return {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    document: { url: sourceUrl, title: document.title },
    pageNumber: primary.pageNumber,
    matchedText,
    textQuote: buildTextQuoteForSelection(primary.page, matchedText),
    rects,
    occurrence: 1
  };
}
function pdfGetSelectionInfo() {
  const selection = window.getSelection();
  const base = {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    source: "onhand-pdf-viewer",
    url: sourceUrl,
    title: document.title,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
  if (!selection || selection.rangeCount === 0) {
    return {
      ...base,
      hasSelection: false,
      isCollapsed: true,
      text: "",
      rangeCount: 0,
      rect: null,
      container: null
    };
  }
  const range = selection.getRangeAt(0);
  const text = normalizeText(selection.toString());
  let rect = null;
  try {
    rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
  } catch {
    rect = null;
  }
  if (!text) {
    return {
      ...base,
      hasSelection: false,
      isCollapsed: selection.isCollapsed,
      text: "",
      rangeCount: selection.rangeCount,
      rect: rect && (rect.width || rect.height) ? rectToObject(rect) : null,
      container: null
    };
  }
  const pdfAnchor = buildPdfAnchorForSelection(range, text);
  const pageNumber = pdfAnchor?.pageNumber || getPageNumber(getPdfPageForNode(range.startContainer));
  return {
    ...base,
    hasSelection: true,
    isCollapsed: selection.isCollapsed,
    text,
    rangeCount: selection.rangeCount,
    rect: rect && (rect.width || rect.height) ? rectToObject(rect) : null,
    container: pageNumber ? {
      tag: "pdf-page",
      selector: `.page[data-page-number="${pageNumber}"]`,
      text: `Page ${pageNumber}`,
      pageNumber
    } : null,
    pageNumber: pageNumber || null,
    ...pdfAnchor ? { pdfAnchor } : {}
  };
}
function snippetForMatch(pageText, matchedText, maxContextChars, matchIndex = null) {
  const text = normalizeText(pageText);
  const match = normalizeText(matchedText);
  if (!text) return { before: "", text: match, after: "", snippet: match };
  const index = Number.isInteger(matchIndex) && Number(matchIndex) >= 0 ? Number(matchIndex) : match ? text.toLowerCase().indexOf(match.toLowerCase()) : -1;
  if (index === -1) {
    const snippet = text.slice(0, Math.max(0, maxContextChars * 2));
    return { before: "", text: match, after: snippet, snippet };
  }
  const before = text.slice(Math.max(0, index - maxContextChars), index);
  const after = text.slice(index + match.length, index + match.length + maxContextChars);
  return {
    before,
    text: text.slice(index, index + match.length),
    after,
    snippet: normalizeText(`${before} ${text.slice(index, index + match.length)} ${after}`)
  };
}
function parsePdfPageNumbers(options = {}) {
  const pageCount = Number(pdfDocument?.numPages || getPdfPages().length || 0);
  const clamp = (value) => Math.max(1, Math.min(pageCount || 1, Math.floor(value)));
  const values = [];
  const rawPages = options.pages;
  if (Array.isArray(rawPages)) {
    for (const value of rawPages) {
      const pageNumber = Number(value);
      if (Number.isFinite(pageNumber) && pageNumber > 0) values.push(clamp(pageNumber));
    }
  } else if (typeof rawPages === "string") {
    for (const part of rawPages.split(/[\s,]+/)) {
      const pageNumber = Number(part);
      if (Number.isFinite(pageNumber) && pageNumber > 0) values.push(clamp(pageNumber));
    }
  }
  if (!values.length) {
    const singlePage = Number(options.pageNumber || options.page || options.pdfAnchor?.pageNumber || "");
    if (Number.isFinite(singlePage) && singlePage > 0) values.push(clamp(singlePage));
  }
  if (!values.length) {
    const startPage = Number(options.startPage || options.start || pageInput.value || 1);
    const endPage = Number(options.endPage || options.end || startPage);
    if (Number.isFinite(startPage) && Number.isFinite(endPage) && startPage > 0 && endPage > 0) {
      const start = clamp(Math.min(startPage, endPage));
      const end = clamp(Math.max(startPage, endPage));
      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) values.push(pageNumber);
    }
  }
  return [...new Set(values)].sort((a, b) => a - b);
}
var cachedPdfTextLayerInfo = null;
async function describePdfTextLayer() {
  if (cachedPdfTextLayerInfo) return cachedPdfTextLayerInfo;
  const pageCount = Number(pdfDocument?.numPages || 0);
  const maxPages = Math.min(pageCount, 30);
  let extractableChars = 0;
  let checkedPages = 0;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    try {
      extractableChars += normalizeText(await getPageTextContent(pageNumber)).length;
    } catch {
    }
    checkedPages += 1;
    if (extractableChars >= 400) break;
  }
  const info2 = { extractableChars, checkedPages, likelyScanned: extractableChars < 40 };
  cachedPdfTextLayerInfo = info2;
  return info2;
}
async function pdfSearch(options = {}) {
  const query = String(options.query || options.text || "").trim();
  if (!query) throw new Error("PDF search requires a non-empty query.");
  const maxMatches = Math.max(1, Math.min(50, Number(options.maxMatches || options.limit || 8) || 8));
  const maxContextChars = Math.max(40, Math.min(1e3, Number(options.maxContextChars || 220) || 220));
  const pages = getPdfPages();
  const totalPageCount = Math.max(Number(pdfDocument?.numPages || 0), pages.length);
  const normalizedQuery = normalizeText(query).toLowerCase();
  const matches = [];
  const searchedPageNumbers = [];
  const failedPageNumbers = [];
  const matchedPageNumbers = /* @__PURE__ */ new Set();
  let totalMatchCount = 0;
  for (const page of pages) {
    const pageNumber = getPageNumber(page);
    if (!pageNumber) continue;
    const textLayer2 = page.querySelector(".textLayer");
    let pageText = "";
    try {
      pageText = textLayer2 ? pdfPageText(page) : await getPageTextContent(pageNumber);
      searchedPageNumbers.push(pageNumber);
    } catch {
      failedPageNumbers.push(pageNumber);
      continue;
    }
    const lowerText = pageText.toLowerCase();
    let fromIndex = 0;
    for (let occurrence = 1; ; occurrence += 1) {
      const index = normalizedQuery ? lowerText.indexOf(normalizedQuery, fromIndex) : -1;
      if (index === -1) break;
      fromIndex = index + Math.max(1, normalizedQuery.length);
      totalMatchCount += 1;
      matchedPageNumbers.add(pageNumber);
      if (matches.length >= maxMatches) continue;
      const matchedText = pageText.slice(index, index + normalizedQuery.length);
      const mappedMatch = textLayer2 ? findMappedTextRange(textLayer2, query, occurrence) : null;
      const anchoredText = mappedMatch?.matchedText || matchedText;
      const snippet = snippetForMatch(pageText, anchoredText, maxContextChars, index);
      const pendingRender = !textLayer2;
      const pdfAnchor = mappedMatch ? buildPdfAnchor(page, mappedMatch, occurrence) : {
        surface: "pdf",
        viewer: "onhand-pdf-viewer",
        document: { url: sourceUrl, title: document.title },
        pageNumber,
        matchedText: anchoredText,
        textQuote: { exact: anchoredText },
        occurrence
      };
      matches.push({
        pageNumber,
        occurrence,
        matchedText: anchoredText,
        before: snippet.before,
        after: snippet.after,
        snippet: snippet.snippet,
        visible: textLayer2 ? visibleEnough(page.getBoundingClientRect()) : false,
        ...pendingRender ? { pendingRender: true } : {},
        pdfAnchor
      });
    }
  }
  const searchedAllPages = totalPageCount > 0 && searchedPageNumbers.length === totalPageCount && failedPageNumbers.length === 0;
  const truncated = totalMatchCount > matches.length;
  const textLayer = totalMatchCount === 0 ? await describePdfTextLayer() : null;
  return {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    url: sourceUrl,
    title: document.title,
    query,
    matchCount: totalMatchCount,
    totalMatchCount,
    returnedMatchCount: matches.length,
    truncated,
    coverage: {
      searchKind: "exact-text",
      searchedPageCount: searchedPageNumbers.length,
      totalPageCount,
      searchedAllPages,
      searchedPageNumbers,
      failedPageNumbers,
      matchedPageNumbers: [...matchedPageNumbers].sort((left, right) => left - right)
    },
    matches,
    ...textLayer ? { textLayer } : {}
  };
}
async function pdfReadPages(options = {}) {
  const maxChars = Math.max(500, Math.min(5e4, Number(options.maxChars || 12e3) || 12e3));
  const pageNumbers = parsePdfPageNumbers(options).slice(0, Math.max(1, Math.min(30, Number(options.maxPages || 12) || 12)));
  const blocks = [];
  let usedChars = 0;
  for (const pageNumber of pageNumbers) {
    const page = getPdfPageByNumber(pageNumber);
    if (!page) continue;
    const text = isPendingPage(page) ? await getPageTextContent(pageNumber) : pdfPageText(page);
    if (!text) continue;
    const remaining = maxChars - usedChars;
    if (remaining <= 0) break;
    const clipped = text.length > remaining ? `${text.slice(0, Math.max(0, remaining - 3))}...` : text;
    usedChars += clipped.length + 2;
    blocks.push({
      tag: "pdf-page",
      pageNumber,
      selector: `.page[data-page-number="${pageNumber}"]`,
      text: clipped,
      rect: rectToObject(page.getBoundingClientRect())
    });
  }
  return {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    url: sourceUrl,
    title: document.title,
    pageNumbers,
    blockCount: blocks.length,
    charCount: blocks.reduce((total, block) => total + String(block.text || "").length, 0),
    truncated: usedChars >= maxChars,
    blocks,
    text: blocks.map((block) => `[p. ${block.pageNumber}] ${block.text}`).join("\n\n").slice(0, maxChars)
  };
}
function isPrivateIpv4Address(hostname) {
  const octets = hostname.split(".");
  if (octets.length !== 4) return false;
  const numbers = octets.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = numbers;
  return first === 0 || first === 10 || first === 127 || first === 100 && second >= 64 && second <= 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168 || first === 192 && second === 0 || first === 192 && second === 0 && third === 2 || first === 198 && (second === 18 || second === 19) || first === 198 && second === 51 && third === 100 || first === 203 && second === 0 && third === 113 || first >= 224;
}
var PUBLIC_CITATION_TLDS = /* @__PURE__ */ new Set(["com", "org", "net", "edu", "gov", "mil", "int", "io", "ai", "dev", "app", "info", "science", "technology"]);
function hasPublicCitationTld(hostname) {
  const tld = hostname.split(".").pop() || "";
  return /^[a-z]{2}$/.test(tld) || PUBLIC_CITATION_TLDS.has(tld);
}
function isSafeCitationUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return false;
    if (hostname.includes(":")) return false;
    const isIpv4 = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
    if (isIpv4) return !isPrivateIpv4Address(hostname);
    if (!hostname.includes(".") || /\.(local|lan|home|internal|intranet|corp|test|invalid|example|onion)$/i.test(hostname)) return false;
    if (!hasPublicCitationTld(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
function extractCitationIdentifiers(entryText) {
  const text = String(entryText || "");
  const arxivId = text.match(/arxiv[:\s]*(\d{4}\.\d{4,5})(v\d+)?/i)?.[1] || text.match(/\babs\/(\d{4}\.\d{4,5})/i)?.[1] || text.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i)?.[1] || "";
  const doi = text.match(/\b10\.\d{4,9}\/[^\s,;)\]]+/)?.[0]?.replace(/[.,;]+$/, "") || "";
  const rawUrl = text.match(/https?:\/\/[^\s)\]]+/)?.[0]?.replace(/[.,;]+$/, "") || "";
  const url = rawUrl && isSafeCitationUrl(rawUrl) ? rawUrl : "";
  const suggestedUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : url || (doi ? `https://doi.org/${doi}` : "");
  return {
    ...arxivId ? { arxivId } : {},
    ...doi ? { doi } : {},
    ...url ? { url } : {},
    ...suggestedUrl ? { suggestedUrl } : {}
  };
}
async function pdfFindCitation(options = {}) {
  const rawReference = String(options.reference ?? options.label ?? options.query ?? "").trim();
  if (!rawReference) throw new Error('findCitation requires a reference, like "14" or "[14]".');
  const pageCount = Number(pdfDocument?.numPages || 0);
  if (!pageCount) throw new Error("No PDF document is loaded.");
  const bracketNumber = rawReference.match(/^\[?(\d{1,3})\]?$/)?.[1] || "";
  let referencesStartPage = 0;
  for (let pageNumber = pageCount; pageNumber >= 1; pageNumber -= 1) {
    const text = await getPageTextContent(pageNumber);
    if (/\b(references|bibliography)\b/i.test(text)) {
      referencesStartPage = pageNumber;
      break;
    }
  }
  const searchStartPage = referencesStartPage || 1;
  let entryText = "";
  let entryPageNumber = 0;
  if (bracketNumber) {
    const entryPattern = new RegExp(`\\[${bracketNumber}\\]\\s`);
    const nextEntryPattern = /\[\d{1,3}\]\s/g;
    for (let pageNumber = searchStartPage; pageNumber <= pageCount; pageNumber += 1) {
      const text = await getPageTextContent(pageNumber);
      const match = entryPattern.exec(text);
      if (!match) continue;
      const start = match.index;
      nextEntryPattern.lastIndex = start + match[0].length;
      const next = nextEntryPattern.exec(text);
      entryText = normalizeText(text.slice(start, next ? next.index : start + 600)).slice(0, 600);
      entryPageNumber = pageNumber;
      break;
    }
  } else {
    const needle = normalizeText(rawReference).toLowerCase();
    for (let pageNumber = searchStartPage; pageNumber <= pageCount; pageNumber += 1) {
      const text = await getPageTextContent(pageNumber);
      const index = text.toLowerCase().indexOf(needle);
      if (index === -1) continue;
      entryText = normalizeText(text.slice(index, index + 600)).slice(0, 600);
      entryPageNumber = pageNumber;
      break;
    }
  }
  if (!entryText) {
    return {
      surface: "pdf",
      viewer: "onhand-pdf-viewer",
      url: sourceUrl,
      found: false,
      reference: rawReference,
      referencesStartPage: referencesStartPage || null,
      message: referencesStartPage ? `No bibliography entry matched "${rawReference}" from page ${referencesStartPage} onward.` : `No references section was found, and nothing matched "${rawReference}".`
    };
  }
  const anchorQuote = entryText.slice(0, 110);
  return {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    url: sourceUrl,
    found: true,
    reference: rawReference,
    pageNumber: entryPageNumber,
    referencesStartPage: referencesStartPage || null,
    entryText,
    identifiers: extractCitationIdentifiers(entryText),
    highlightAnchor: {
      surface: "pdf",
      viewer: "onhand-pdf-viewer",
      document: { url: sourceUrl, title: document.title },
      pageNumber: entryPageNumber,
      matchedText: anchorQuote,
      textQuote: { exact: anchorQuote },
      occurrence: 1
    }
  };
}
async function pdfJumpToPage(options = {}) {
  const anchor = options.pdfAnchor || null;
  const pageNumber = Number(options.pageNumber || options.page || anchor?.pageNumber || "");
  if (!Number.isFinite(pageNumber) || pageNumber < 1) throw new Error("PDF jump requires a valid pageNumber.");
  const page = getPdfPageByNumber(pageNumber);
  if (!page) throw new Error(`PDF page not found: ${pageNumber}`);
  await ensurePageRendered(pageNumber);
  scrollToPage(pageNumber);
  await waitForNextFrame();
  const text = String(options.text || anchor?.matchedText || anchor?.textQuote?.exact || "").trim();
  let matchAnchor = null;
  if (text) {
    const textLayer = page.querySelector(".textLayer");
    const occurrence = Math.max(1, Math.min(100, Number(options.occurrence || anchor?.occurrence || 1) || 1));
    const match = textLayer ? findMappedTextRange(textLayer, text, occurrence, anchor?.textQuote) : null;
    if (match) {
      match.range.startContainer.parentElement?.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
      await waitForNextFrame();
      matchAnchor = buildPdfAnchor(page, match, occurrence);
    }
  }
  updatePageFromScroll();
  return {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    url: sourceUrl,
    title: document.title,
    pageNumber,
    text: text || "",
    pdfAnchor: matchAnchor || anchor || null,
    viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY }
  };
}
async function pdfCapturePageImage(options = {}) {
  const pageNumber = Number(options.pageNumber || options.page || pageInput.value || 1);
  if (!Number.isFinite(pageNumber) || pageNumber < 1) throw new Error("PDF page image capture requires a valid pageNumber.");
  const page = getPdfPageByNumber(pageNumber);
  if (!page) throw new Error(`PDF page not found: ${pageNumber}`);
  commitTransientZoom();
  await ensurePageRendered(pageNumber, renderSequence, { sharpen: true });
  const canvas = page.querySelector("canvas");
  if (!canvas) throw new Error(`PDF page ${pageNumber} has no rendered canvas.`);
  const format = String(options.format || "png").toLowerCase() === "jpeg" ? "jpeg" : "png";
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const quality = Math.max(0.1, Math.min(1, Number(options.quality || 0.92) || 0.92));
  scrollToPage(pageNumber);
  await waitForNextFrame();
  const dataUrl = format === "jpeg" ? canvas.toDataURL(mimeType, quality) : canvas.toDataURL(mimeType);
  return {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    url: sourceUrl,
    title: document.title,
    pageNumber,
    mimeType,
    dataUrl,
    data: dataUrl.includes(",") ? dataUrl.split(",")[1] : "",
    width: canvas.width,
    height: canvas.height,
    cssWidth: Number(canvas.style.width?.replace("px", "")) || page.clientWidth,
    cssHeight: Number(canvas.style.height?.replace("px", "")) || page.clientHeight
  };
}
function pdfCaptureState() {
  const annotations = Array.from(document.querySelectorAll("[data-onhand-highlight-kind='pdf']")).map((annotation) => {
    const annotationId = annotation.getAttribute("data-onhand-annotation-id") || "";
    const note = annotationId ? document.querySelector(`[data-onhand-note-for="${CSS.escape(annotationId)}"]`) : null;
    const body = note?.querySelector("[data-onhand-note-part='body']");
    const label = note?.querySelector("[data-onhand-note-part='label']");
    return {
      ...buildAnnotationResult(annotation),
      note: note ? {
        noteId: note.getAttribute("data-onhand-note-id") || null,
        label: normalizeText(label?.textContent || "") || null,
        text: normalizeText(body?.getAttribute("data-onhand-note-source") || body?.textContent || "").slice(0, 1e3),
        rect: rectToObject(note.getBoundingClientRect())
      } : null
    };
  });
  return {
    surface: "pdf",
    viewer: "onhand-pdf-viewer",
    url: sourceUrl,
    title: document.title,
    text: pdfGetVisibleText({ maxChars: 4e3, maxBlocks: 8 }).text,
    annotations,
    annotationCount: annotations.length,
    scrollY: window.scrollY,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
}
async function runPdfToolkitMethod(methodName, args = []) {
  switch (methodName) {
    case "getVisibleText":
      return pdfGetVisibleText(args[0] || {});
    case "searchPdf":
      return pdfSearch(args[0] || {});
    case "findCitation":
      return await pdfFindCitation(args[0] || {});
    case "readPdfPages":
      return pdfReadPages(args[0] || {});
    case "jumpToPdfPage":
      return await pdfJumpToPage(args[0] || {});
    case "capturePdfPageImage":
      return await pdfCapturePageImage(args[0] || {});
    case "highlightText":
      return await pdfHighlightText(String(args[0] || ""), args[1] || {});
    case "showNote":
      return await pdfShowNote(String(args[0] || ""), String(args[1] || ""), args[2] || {});
    case "scrollToAnnotation":
      return await pdfScrollToAnnotation(String(args[0] || ""), args[1] || {});
    case "captureState":
      return pdfCaptureState();
    case "clearAnnotations":
      return pdfClearAnnotations();
    case "removeAnnotations":
      return pdfRemoveAnnotations(args[0] || []);
    case "getSelectionInfo":
      return pdfGetSelectionInfo();
    default:
      throw new Error(`Unsupported Onhand PDF viewer toolkit method: ${methodName || "(blank)"}`);
  }
}
async function runViewerCommand(data) {
  const command = String(data?.command || "");
  if (command === "evaluate") return await evaluateBridgeExpression(data?.expression);
  if (command === "status") {
    return {
      ready: document.body?.getAttribute("data-onhand-pdf-rendered") === "true",
      error: document.querySelector(".onhand-pdf-error")?.textContent || "",
      statusText: document.querySelector("#onhand-pdf-status")?.textContent || "",
      pageCountText: document.querySelector("#onhand-pdf-page-count")?.textContent || "",
      pageNumber: Number.parseInt(pageInput?.value || "1", 10) || 1,
      sourceUrl
    };
  }
  if (command === "page-toolkit-method") {
    return await runPdfToolkitMethod(String(data?.methodName || ""), Array.isArray(data?.args) ? data.args : []);
  }
  throw new Error(`Unsupported Onhand PDF viewer bridge command: ${command || "(blank)"}`);
}
function postRuntimeBridgeResult(port, requestId, payload) {
  try {
    port.postMessage({
      type: "onhand-pdf-viewer-evaluate-result",
      requestId,
      ...payload
    });
  } catch {
  }
}
async function handleRuntimeBridgeCommand(data, port) {
  const requestId = String(data?.requestId || "");
  try {
    const value = await runViewerCommand(data);
    postRuntimeBridgeResult(port, requestId, {
      ok: true,
      value
    });
  } catch (error) {
    postRuntimeBridgeResult(port, requestId, {
      ok: false,
      error: error?.message || String(error)
    });
  }
}
function scheduleRuntimeBridgeReconnect() {
  if (runtimeBridgeReconnectTimer !== null || !sourceUrl) return;
  runtimeBridgeReconnectTimer = window.setTimeout(() => {
    runtimeBridgeReconnectTimer = null;
    connectRuntimeBridge();
  }, 500);
}
function connectRuntimeBridge() {
  if (!sourceUrl || typeof chrome === "undefined" || !chrome?.runtime?.connect || runtimeBridgePort) return;
  try {
    const port = chrome.runtime.connect({ name: "onhand-pdf-viewer" });
    runtimeBridgePort = port;
    port.postMessage({
      type: "onhand-pdf-viewer-register",
      sourceUrl
    });
    port.onMessage?.addListener?.((data) => {
      if (data?.type !== "onhand-pdf-viewer-evaluate") return;
      void handleRuntimeBridgeCommand(data, port);
    });
    port.onDisconnect?.addListener?.(() => {
      runtimeBridgePort = null;
      scheduleRuntimeBridgeReconnect();
    });
  } catch {
    runtimeBridgePort = null;
    scheduleRuntimeBridgeReconnect();
  }
}
async function handleBridgeCommand(data, port) {
  const requestId = data?.requestId || "";
  const postResult = (payload) => {
    try {
      port.postMessage({
        type: "onhand-pdf-viewer-bridge-result",
        requestId,
        ...payload
      });
    } finally {
      try {
        port.close();
      } catch {
      }
    }
  };
  try {
    const commandSourceUrl = String(data?.sourceUrl || "");
    if (!sourceUrl || commandSourceUrl !== sourceUrl) {
      throw new Error("Unauthorized Onhand PDF viewer bridge command.");
    }
    const expectedToken = await getBridgeToken();
    if (!expectedToken || data?.token !== expectedToken) {
      throw new Error("Unauthorized Onhand PDF viewer bridge command.");
    }
    const value = await runViewerCommand(data);
    postResult({
      ok: true,
      value
    });
  } catch (error) {
    postResult({
      ok: false,
      error: error?.message || String(error)
    });
  }
}
window.addEventListener("message", (event) => {
  const data = event?.data || {};
  if (data?.type === "onhand-pdf-viewer-bridge-init") return;
  if (data?.type !== "onhand-pdf-viewer-bridge-command") return;
  const port = event.ports?.[0];
  if (!port) return;
  void handleBridgeCommand(data, port);
});
function setStatus(message) {
  statusElement.textContent = message;
}
function showError(message) {
  viewer.replaceChildren();
  const error = document.createElement("section");
  error.className = "onhand-pdf-error";
  error.textContent = message;
  viewer.append(error);
  setStatus("Error");
}
function parseSourceUrl() {
  const params = new URLSearchParams(location.search);
  const raw = params.get("url") || params.get("file") || "";
  if (!raw.trim()) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") return "";
    return parsed.href;
  } catch {
    return "";
  }
}
function isHttpsUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}
async function getPdfDocumentWithTimeout(options, timeoutMs) {
  const loadingTask = __webpack_exports__getDocument(options);
  let timeoutId = null;
  try {
    return await Promise.race([
      loadingTask.promise,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("Timed out loading the PDF.")), timeoutMs);
      })
    ]);
  } catch (error) {
    try {
      await loadingTask.destroy();
    } catch {
    }
    throw error;
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}
async function loadLocalFilePdfBytes(value) {
  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", value, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => {
      if (xhr.response && (xhr.status === 200 || xhr.status === 0)) resolve(xhr.response);
      else reject(new Error(`Could not read the local PDF (status ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Could not read the local PDF file."));
    xhr.send();
  });
}
function decodeBase64PdfBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
async function loadPdfDocumentFromUrl(value) {
  const baseOptions = {
    url: value,
    cMapUrl: extensionUrl("vendor/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: extensionUrl("vendor/standard_fonts/")
  };
  if (value.startsWith("file:")) {
    let authorized = false;
    try {
      const auth = await chrome.runtime.sendMessage({ type: "pdf-viewer:authorize-file-source", url: value });
      authorized = Boolean(auth?.ok);
    } catch {
    }
    if (!authorized) {
      throw new Error(
        "For security, Onhand only opens local PDFs it handed off itself. Open the file in a browser tab and ask Onhand from there, or reopen it from your Onhand session."
      );
    }
    try {
      const data = await loadLocalFilePdfBytes(value);
      const { url: _url, ...optionsWithoutUrl } = baseOptions;
      return await getPdfDocumentWithTimeout({ ...optionsWithoutUrl, data }, PDF_LOAD_TIMEOUT_MS);
    } catch (error) {
      throw new Error(
        `Could not open this local PDF. If Onhand does not have file access, open chrome://extensions, find Onhand, enable "Allow access to file URLs", then retry. (${error?.message || String(error)})`
      );
    }
  }
  try {
    return await getPdfDocumentWithTimeout(baseOptions, PDF_LOAD_TIMEOUT_MS);
  } catch (initialError) {
    if (!isHttpsUrl(value)) throw initialError;
    let authorized = false;
    try {
      const auth = await chrome.runtime.sendMessage({ type: "pdf-viewer:authorize-credentialed-source", url: value });
      authorized = Boolean(auth?.ok);
    } catch {
    }
    if (!authorized) throw initialError;
    setStatus("Retrying with browser credentials...");
    try {
      return await getPdfDocumentWithTimeout(
        { ...baseOptions, withCredentials: true },
        CREDENTIALED_PDF_LOAD_RETRY_TIMEOUT_MS
      );
    } catch (credentialError) {
      setStatus("Retrying through the authenticated browser tab...");
      let browserLoad = null;
      try {
        browserLoad = await chrome.runtime.sendMessage({ type: "pdf-viewer:load-authorized-source", url: value });
      } catch {
      }
      if (!browserLoad?.ok || !browserLoad?.dataBase64) {
        throw new Error(
          browserLoad?.error || credentialError?.message || initialError?.message || "Could not load the protected PDF."
        );
      }
      const data = decodeBase64PdfBytes(String(browserLoad.dataBase64));
      const { url: _url, ...optionsWithoutUrl } = baseOptions;
      return await getPdfDocumentWithTimeout({ ...optionsWithoutUrl, data }, PDF_LOAD_TIMEOUT_MS);
    }
  }
}
function normalizeViewerPageNumber(value, maxPage = Number.MAX_SAFE_INTEGER) {
  const match = String(value ?? "").match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const upperBound = Number.isFinite(maxPage) && maxPage > 0 ? Math.floor(maxPage) : Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.min(upperBound, parsed));
}
function normalizeViewerScrollRatio(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return null;
  return Math.max(0, Math.min(1, parsed));
}
function parseInitialPageNumber(maxPage = Number.MAX_SAFE_INTEGER) {
  const params = new URLSearchParams(location.search);
  for (const key of ["page", "pageNumber", "initialPage", "p"]) {
    const pageNumber = normalizeViewerPageNumber(params.get(key), maxPage);
    if (pageNumber) return pageNumber;
  }
  const hash = String(location.hash || "").replace(/^#/, "");
  if (!hash) return null;
  const hashParams = new URLSearchParams(hash.includes("=") ? hash : `page=${hash}`);
  for (const key of ["page", "pageNumber", "initialPage", "p"]) {
    const pageNumber = normalizeViewerPageNumber(hashParams.get(key), maxPage);
    if (pageNumber) return pageNumber;
  }
  return normalizeViewerPageNumber(hash.match(/\bpage[=/:-](\d+)\b/i)?.[1], maxPage);
}
function parseInitialScrollRatio() {
  const params = new URLSearchParams(location.search);
  for (const key of ["scrollRatio", "initialScrollRatio"]) {
    const scrollRatio = normalizeViewerScrollRatio(params.get(key));
    if (scrollRatio) return scrollRatio;
  }
  const hash = String(location.hash || "").replace(/^#/, "");
  if (!hash) return null;
  const hashParams = new URLSearchParams(hash.includes("=") ? hash : `scrollRatio=${hash}`);
  for (const key of ["scrollRatio", "initialScrollRatio"]) {
    const scrollRatio = normalizeViewerScrollRatio(hashParams.get(key));
    if (scrollRatio) return scrollRatio;
  }
  return normalizeViewerScrollRatio(hash.match(/\bscrollRatio[=/:-]([.\d]+)\b/i)?.[1]);
}
function pageNumberFromScrollRatio(scrollRatio, maxPage) {
  if (!scrollRatio || !Number.isFinite(maxPage) || maxPage <= 1) return null;
  return normalizeViewerPageNumber(Math.round(scrollRatio * (maxPage - 1)) + 1, maxPage);
}
function updateViewerPageUrl(pageNumber) {
  const normalized = normalizeViewerPageNumber(pageNumber, Number(pdfDocument?.numPages || 0) || Number.MAX_SAFE_INTEGER);
  if (!normalized) return;
  try {
    const nextUrl = new URL(location.href);
    if (normalized <= 1) {
      nextUrl.searchParams.delete("page");
    } else {
      nextUrl.searchParams.set("page", String(normalized));
    }
    const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    const currentPath = `${location.pathname}${location.search}${location.hash}`;
    if (nextPath !== currentPath) history.replaceState(null, "", nextPath);
  } catch {
  }
}
function setCurrentPageNumber(pageNumber, options = {}) {
  const normalized = normalizeViewerPageNumber(pageNumber, Number(pdfDocument?.numPages || 0) || Number.MAX_SAFE_INTEGER);
  if (!normalized) return;
  pageInput.value = String(normalized);
  if (options.updateUrl !== false) updateViewerPageUrl(normalized);
}
function sourceTitle(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname);
  } catch {
    return "PDF";
  }
}
function updatePageFromScroll() {
  const bestPage = findViewportPage();
  if (!bestPage) return;
  setCurrentPageNumber(bestPage.getAttribute("data-page-number") || "1");
}
function scrollToPage(pageNumber) {
  const target = document.querySelector(`.page[data-page-number="${pageNumber}"]`);
  if (!target) return;
  target.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
  setCurrentPageNumber(pageNumber);
  void ensurePageRendered(pageNumber);
}
async function renderPageContent(pageElement, pageNumber, sequence) {
  const page = await pdfDocument.getPage(pageNumber);
  if (sequence !== renderSequence) return;
  const renderScale = committedScale;
  const viewport = page.getViewport({ scale: renderScale });
  pageElement.style.width = `${viewport.width}px`;
  pageElement.style.height = `${viewport.height}px`;
  const canvasWrapper = document.createElement("div");
  canvasWrapper.className = "canvasWrapper";
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Could not create canvas context for PDF page.");
  const outputScale = canvasOutputScale(viewport);
  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  canvasWrapper.append(canvas);
  let textLayer = pageElement.querySelector(".textLayer");
  const needsTextLayer = textLayer?.getAttribute("data-onhand-pdf-text-ready") !== "true";
  if (needsTextLayer) {
    textLayer?.remove();
    textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    textLayer.setAttribute("data-onhand-pdf-text-layer", "true");
    pageElement.append(textLayer);
  }
  await page.render({
    canvasContext: context,
    viewport,
    transform: outputScale === 1 ? void 0 : [outputScale, 0, 0, outputScale, 0, 0],
    // Display-intent rendering schedules every paint chunk on
    // requestAnimationFrame, which never fires while this document is
    // hidden (background tab or occluded window) — the render promise
    // stalls forever, the viewer never reports ready, and background
    // viewer opens die on the page-command budget ("Timed out waiting for
    // page command"). Print intent paints through microtasks instead;
    // rasters are equivalent for reading, and visible tabs keep the
    // cooperative display scheduling.
    intent: document.visibilityState === "hidden" ? "print" : "display"
  }).promise;
  if (sequence !== renderSequence) return;
  const oldCanvasWrapper = pageElement.querySelector(".canvasWrapper");
  if (oldCanvasWrapper) oldCanvasWrapper.replaceWith(canvasWrapper);
  else pageElement.prepend(canvasWrapper);
  pageElement.setAttribute("data-onhand-pdf-raster-scale", String(renderScale));
  pageElement.setAttribute("data-onhand-pdf-output-scale", String(outputScale));
  if (needsTextLayer) {
    const textContentSource = typeof page.streamTextContent === "function" ? page.streamTextContent({ includeMarkedContent: true }) : await page.getTextContent({ includeMarkedContent: true });
    const layer = new __webpack_exports__TextLayer({
      textContentSource,
      container: textLayer,
      viewport
    });
    await layer.render();
    if (sequence !== renderSequence) return;
    textLayer.setAttribute("data-onhand-pdf-text-ready", "true");
    textLayer.querySelectorAll("span").forEach((span, index) => {
      span.setAttribute("data-onhand-pdf-text-span", String(index));
    });
  }
}
var pageRenderPromises = /* @__PURE__ */ new Map();
var pageTextContentCache = /* @__PURE__ */ new Map();
function isPendingPage(pageElement) {
  return pageElement?.getAttribute("data-onhand-pdf-pending") === "true";
}
function pageNeedsSharperRender(pageElement) {
  if (!pageElement?.querySelector("canvas")) return true;
  const rasterScale = Number(pageElement.getAttribute("data-onhand-pdf-raster-scale") || 0) || 0;
  return rasterScale + 0.01 < currentScale;
}
function compactPendingSearchText(value) {
  return String(value || "").toLowerCase().replace(/[\s ]+/g, "");
}
async function getPageTextContent(pageNumber) {
  const cached = pageTextContentCache.get(pageNumber);
  if (cached !== void 0) return cached;
  try {
    const page = await pdfDocument.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = normalizeText(
      content.items.map((item) => `${typeof item?.str === "string" ? item.str : ""}${item?.hasEOL ? "\n" : ""}`).join("")
    );
    pageTextContentCache.set(pageNumber, text);
    return text;
  } catch {
    return "";
  }
}
async function createPageShells(sequence) {
  const firstPage = await pdfDocument.getPage(1);
  if (sequence !== renderSequence) return;
  const baseViewport = firstPage.getViewport({ scale: committedScale });
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const pageElement = document.createElement("section");
    pageElement.className = "page";
    pageElement.setAttribute("data-page-number", String(pageNumber));
    pageElement.setAttribute("data-onhand-pdf-page", "true");
    pageElement.setAttribute("data-onhand-pdf-pending", "true");
    pageElement.setAttribute("data-onhand-pdf-raster-scale", "0");
    pageElement.style.width = `${baseViewport.width}px`;
    pageElement.style.height = `${baseViewport.height}px`;
    viewer.append(pageElement);
  }
}
function ensurePageRendered(pageNumber, sequence = renderSequence, options = {}) {
  const pageElement = getPdfPageByNumber(pageNumber);
  const needsInitialRender = Boolean(pageElement && (isPendingPage(pageElement) || !pageElement.querySelector("canvas") || !pageElement.querySelector('[data-onhand-pdf-text-ready="true"]')));
  const needsSharperRender = Boolean(pageElement && options.sharpen && pageNeedsSharperRender(pageElement));
  if (!pageElement || !needsInitialRender && !needsSharperRender) return Promise.resolve();
  const existing = pageRenderPromises.get(pageNumber);
  if (existing) return existing;
  let promise;
  promise = (async () => {
    await renderPageContent(pageElement, pageNumber, sequence);
    if (sequence === renderSequence && pageElement.querySelector("canvas") && pageElement.querySelector('[data-onhand-pdf-text-ready="true"]')) {
      pageElement.removeAttribute("data-onhand-pdf-pending");
    }
  })().finally(() => {
    if (pageRenderPromises.get(pageNumber) === promise) pageRenderPromises.delete(pageNumber);
  });
  pageRenderPromises.set(pageNumber, promise);
  return promise;
}
function nextPendingPageNumber() {
  const currentNumber = Number(pageInput.value || 1) || getPageNumber(findViewportPage()) || 1;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const pageElement of getPdfPages()) {
    if (!isPendingPage(pageElement)) continue;
    const pageNumber = getPageNumber(pageElement);
    if (!pageNumber) continue;
    const distance = Math.abs(pageNumber - currentNumber);
    if (distance < bestDistance) {
      best = pageNumber;
      bestDistance = distance;
    }
  }
  return best;
}
function countPendingPages() {
  return getPdfPages().filter((pageElement) => isPendingPage(pageElement)).length;
}
async function renderRemainingPages(sequence) {
  while (sequence === renderSequence) {
    const pageNumber = nextPendingPageNumber();
    if (!pageNumber) break;
    await ensurePageRendered(pageNumber, sequence);
    if (sequence !== renderSequence) return;
    const total = Number(pdfDocument?.numPages || 0);
    const pendingCount = countPendingPages();
    if (pendingCount > 0) setStatus(`Rendered ${total - pendingCount}/${total}`);
  }
  if (sequence === renderSequence && !countPendingPages()) {
    document.body.setAttribute("data-onhand-pdf-rendered", "true");
    setStatus("Ready");
    scheduleViewportRender();
  }
}
async function findPendingPageWithText(query) {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const compactQuery = compactPendingSearchText(query);
  if (!normalizedQuery) return null;
  for (const pageElement of getPdfPages()) {
    if (!isPendingPage(pageElement)) continue;
    const pageNumber = getPageNumber(pageElement);
    if (!pageNumber) continue;
    const text = (await getPageTextContent(pageNumber)).toLowerCase();
    if (text.includes(normalizedQuery) || compactPendingSearchText(text).includes(compactQuery)) return pageNumber;
  }
  return null;
}
async function renderDocument(options = {}) {
  if (!pdfDocument) return;
  commitTransientZoom();
  const snapshot = options.preserveView ? capturePdfViewSnapshot() : null;
  const sequence = ++renderSequence;
  document.body.removeAttribute("data-onhand-pdf-rendered");
  viewer.replaceChildren();
  pageRenderPromises.clear();
  pageCountElement.textContent = `/ ${pdfDocument.numPages}`;
  pageInput.max = String(pdfDocument.numPages);
  setStatus(`Preparing ${pdfDocument.numPages} pages...`);
  await createPageShells(sequence);
  if (sequence !== renderSequence) return;
  for (let i = 0; i < 3; i += 1) {
    const pageNumber = nextPendingPageNumber();
    if (!pageNumber) break;
    await ensurePageRendered(pageNumber, sequence);
    if (sequence !== renderSequence) return;
  }
  document.body.setAttribute("data-onhand-pdf-rendered", "true");
  const pendingCount = countPendingPages();
  setStatus(pendingCount ? `Rendered ${pdfDocument.numPages - pendingCount}/${pdfDocument.numPages}` : "Ready");
  void renderRemainingPages(sequence);
  await restorePdfViewSnapshot(snapshot, sequence);
}
function pagesOrderedFromViewport() {
  const pages = getPdfPages();
  const current = findViewportPage();
  const currentNumber = getPageNumber(current) || Number(pageInput.value || 1) || 1;
  return [...pages].sort(
    (left, right) => Math.abs((getPageNumber(left) || 0) - currentNumber) - Math.abs((getPageNumber(right) || 0) - currentNumber)
  );
}
function pagesNearViewport() {
  const ordered = pagesOrderedFromViewport();
  const toolbar = document.querySelector(".onhand-pdf-toolbar");
  const toolbarBottom = toolbar?.getBoundingClientRect().bottom || 0;
  const visible = ordered.filter((pageElement) => {
    const rect = pageElement.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > toolbarBottom && rect.top < window.innerHeight;
  });
  return (visible.length ? visible : ordered).slice(0, 2);
}
async function renderSharpPagesNearViewport(sequence = renderSequence, expectedZoomRevision = zoomRevision) {
  for (const pageElement of pagesNearViewport()) {
    if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
    const pageNumber = getPageNumber(pageElement);
    if (!pageNumber) continue;
    await ensurePageRendered(pageNumber, sequence, { sharpen: true });
    if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
    if (pageNeedsSharperRender(pageElement)) {
      await ensurePageRendered(pageNumber, sequence, { sharpen: true });
    }
  }
}
function settleZoomRender(sequence, expectedZoomRevision) {
  if (zoomRenderTimer !== null) window.clearTimeout(zoomRenderTimer);
  zoomRenderTimer = window.setTimeout(async () => {
    zoomRenderTimer = null;
    if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
    commitTransientZoom();
    const annotations = capturePdfAnnotationSnapshots();
    const pendingCountBeforeSharpen = countPendingPages();
    if (pendingCountBeforeSharpen) {
      await rebuildPdfAnnotationLayers(annotations, sequence);
      if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
      setStatus(`Rendered ${Number(pdfDocument?.numPages || 0) - pendingCountBeforeSharpen}/${pdfDocument?.numPages || 0}`);
      return;
    }
    if (pagesNearViewport().some((page) => pageNeedsSharperRender(page))) {
      setStatus(`Sharpening visible pages at ${Math.round(currentScale * 100)}%...`);
    }
    await renderSharpPagesNearViewport(sequence, expectedZoomRevision);
    if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
    await rebuildPdfAnnotationLayers(annotations, sequence);
    if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
    const pendingCount = countPendingPages();
    setStatus(pendingCount ? `Rendered ${Number(pdfDocument?.numPages || 0) - pendingCount}/${pdfDocument?.numPages || 0}` : "Ready");
  }, ZOOM_RENDER_DELAY_MS);
}
function scheduleViewportRender() {
  if (!pdfDocument) return;
  if (viewportRenderTimer !== null) window.clearTimeout(viewportRenderTimer);
  const sequence = renderSequence;
  viewportRenderTimer = window.setTimeout(async () => {
    viewportRenderTimer = null;
    const expectedZoomRevision = zoomRevision;
    if (sequence !== renderSequence || hasTransientZoom()) return;
    await renderSharpPagesNearViewport(sequence, expectedZoomRevision);
  }, VIEWPORT_RENDER_DELAY_MS);
}
function rescaleDocument(nextScale, anchor = captureZoomAnchor()) {
  if (!pdfDocument) return;
  const normalized = clampScale(nextScale);
  if (Math.abs(normalized - currentScale) < 1e-3) return;
  const sequence = renderSequence;
  const expectedZoomRevision = ++zoomRevision;
  applyTransientZoom(normalized, transientZoomAnchor || anchor);
  updateZoomControls();
  setStatus(`Zoom ${Math.round(normalized * 100)}%`);
  settleZoomRender(sequence, expectedZoomRevision);
}
async function loadPdf() {
  sourceUrl = parseSourceUrl();
  if (!sourceUrl) {
    showError("Open this viewer with a valid http(s) PDF URL parameter.");
    return;
  }
  globalThis.__ONHAND_PDF_VIEWER_SOURCE_URL = sourceUrl;
  document.body.setAttribute("data-onhand-pdf-url", sourceUrl);
  connectRuntimeBridge();
  const title = sourceTitle(sourceUrl);
  document.title = `${title} - Onhand PDF Viewer`;
  titleElement.textContent = title;
  __webpack_exports__GlobalWorkerOptions.workerSrc = extensionUrl("vendor/pdf.worker.mjs");
  setStatus("Loading PDF...");
  pdfDocument = await loadPdfDocumentFromUrl(sourceUrl);
  cachedPdfTextLayerInfo = null;
  const pageCount = Number(pdfDocument.numPages || 0);
  const explicitInitialPageNumber = parseInitialPageNumber(pageCount);
  const initialPageNumber = explicitInitialPageNumber || pageNumberFromScrollRatio(parseInitialScrollRatio(), pageCount) || 1;
  setCurrentPageNumber(initialPageNumber);
  currentScale = await computeFitScale(initialPageNumber);
  committedScale = currentScale;
  viewer.style.setProperty("--scale-factor", String(committedScale));
  updateZoomControls();
  lastFitRenderWidth = viewer.clientWidth;
  await renderDocument();
  scrollToPage(initialPageNumber);
}
zoomInButton.addEventListener("click", () => {
  scaleMode = "custom";
  void rescaleDocument(currentScale + SCALE_STEP);
});
zoomOutButton.addEventListener("click", () => {
  scaleMode = "custom";
  void rescaleDocument(currentScale - SCALE_STEP);
});
async function fitPageToWindow() {
  if (!pdfDocument) return;
  commitTransientZoom();
  scaleMode = "fit";
  const nextScale = await computeFitScale(Number(pageInput.value || 1) || 1);
  lastFitRenderWidth = viewer.clientWidth;
  rescaleDocument(nextScale);
  updateZoomControls();
}
zoomValueButton.addEventListener("click", () => {
  void fitPageToWindow();
});
function queueGestureZoom(nextScale, clientX, clientY) {
  queuedGestureScale = clampScale(nextScale);
  queuedGestureClientX = clientX;
  queuedGestureClientY = clientY;
  if (gestureAnimationFrame !== null) return;
  gestureAnimationFrame = requestAnimationFrame(() => {
    gestureAnimationFrame = null;
    const anchor = transientZoomAnchor || captureZoomAnchor(queuedGestureClientX, queuedGestureClientY);
    rescaleDocument(queuedGestureScale, anchor);
  });
}
window.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey || !pdfDocument) return;
    event.preventDefault();
    scaleMode = "custom";
    const deltaPixels = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1);
    const factor = Math.exp(-Math.max(-60, Math.min(60, deltaPixels)) * 0.01);
    const baseScale = gestureAnimationFrame !== null ? queuedGestureScale : currentScale;
    queueGestureZoom(baseScale * factor, event.clientX, event.clientY);
  },
  { passive: false }
);
window.addEventListener(
  "gesturestart",
  ((event) => {
    if (!pdfDocument) return;
    event.preventDefault?.();
    scaleMode = "custom";
    nativeGestureStartScale = currentScale;
  }),
  { passive: false }
);
window.addEventListener(
  "gesturechange",
  ((event) => {
    if (!pdfDocument) return;
    event.preventDefault?.();
    queueGestureZoom(nativeGestureStartScale * (Number(event.scale) || 1), Number(event.clientX) || window.innerWidth / 2, Number(event.clientY) || window.innerHeight / 2);
  }),
  { passive: false }
);
window.addEventListener(
  "keydown",
  (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      scaleMode = "custom";
      rescaleDocument(currentScale + SCALE_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      scaleMode = "custom";
      rescaleDocument(currentScale - SCALE_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      void fitPageToWindow();
    }
  },
  { capture: true }
);
var pendingFitRender = false;
function hasUsableViewerViewport() {
  return !document.hidden && viewer.clientWidth > 1 && window.innerHeight > 1;
}
function scheduleResizeRender() {
  if (!pdfDocument || scaleMode !== "fit") return;
  if (!hasUsableViewerViewport()) {
    pendingFitRender = true;
    return;
  }
  if (viewer.clientWidth === lastFitRenderWidth) return;
  if (resizeRenderTimer !== null) window.clearTimeout(resizeRenderTimer);
  resizeRenderTimer = window.setTimeout(async () => {
    resizeRenderTimer = null;
    if (!pdfDocument || scaleMode !== "fit" || !hasUsableViewerViewport()) return;
    if (viewer.clientWidth === lastFitRenderWidth) return;
    const nextScale = await computeFitScale(Number(pageInput.value || 1) || 1);
    lastFitRenderWidth = viewer.clientWidth;
    if (Math.abs(nextScale - currentScale) < 0.01) return;
    rescaleDocument(nextScale);
  }, RESIZE_RENDER_DELAY_MS);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !pendingFitRender) return;
  pendingFitRender = false;
  scheduleResizeRender();
});
pageInput.addEventListener("change", () => {
  const pageNumber = Number.parseInt(pageInput.value, 10);
  if (Number.isFinite(pageNumber) && pageNumber > 0) scrollToPage(pageNumber);
});
pageInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const pageNumber = Number.parseInt(pageInput.value, 10);
  if (Number.isFinite(pageNumber) && pageNumber > 0) scrollToPage(pageNumber);
});
window.addEventListener(
  "scroll",
  () => {
    updatePageFromScroll();
    scheduleViewportRender();
  },
  { passive: true }
);
window.addEventListener("resize", scheduleResizeRender, { passive: true });
loadPdf().catch((error) => {
  showError(error?.message || String(error));
});
