// Expo Router needs babel-preset-expo so its `require.context` calls
// (in node_modules/expo-router/_ctx.*.js) are transformed against the
// app/ directory. SDK 54+ scaffolds usually rely on the implicit
// preset registration, but in a workspace setup Metro sometimes
// fails to find it without an explicit babel.config.js — the
// _ctx.ios.js / _ctx.web.js files then fail to bundle with
// "process.env.EXPO_ROUTER_APP_ROOT is not a string".
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
  }
}
