var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// App.js
var App_exports = {};
__export(App_exports, {
  default: () => App_default
});
module.exports = __toCommonJS(App_exports);
var import_react = __toESM(require("react"));
var import_ink = require("ink");
var import_ink_big_text = __toESM(require("ink-big-text"));
var App = () => {
  return /* @__PURE__ */ import_react.default.createElement(import_ink.Box, { flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }, /* @__PURE__ */ import_react.default.createElement(import_ink_big_text.default, { text: "QueueBit" }), /* @__PURE__ */ import_react.default.createElement(import_ink.Text, null, "Full-screen TUI CLI"));
};
var App_default = App;
