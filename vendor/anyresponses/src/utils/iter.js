function toAsyncIterable(input) {
  if (!input) {
    throw new TypeError("input must be iterable");
  }
  if (typeof input[Symbol.asyncIterator] === "function") {
    return input;
  }
  if (typeof input[Symbol.iterator] === "function") {
    return (async function* () {
      for (const item of input) {
        yield item;
      }
    })();
  }
  throw new TypeError("input must be iterable");
}

module.exports = {
  toAsyncIterable,
};
