module.exports = function (api) {
  api.cache(true);
  const plugins = [];
  if (process.env.NODE_ENV === "production") {
    // Never ship console output (and whatever it might contain) in release builds.
    plugins.push(["transform-remove-console", { exclude: ["error"] }]);
  }
  return {
    presets: ["babel-preset-expo"],
    plugins,
  };
};
