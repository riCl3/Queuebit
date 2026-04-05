// App.js
import React, { useState, useEffect, useRef, useMemo, memo } from "react";
import { Box, Text, useStdin } from "ink";
import Conf from "conf";
import path from "path";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import { io } from "socket.io-client";
var conf = new Conf({
  projectName: "queuebit",
  defaults: {
    apiKey: "",
    model: "gemini-3-flash-preview"
  }
});
var api = axios.create({
  baseURL: "http://localhost:3000",
  timeout: 3e4,
  headers: {
    "Content-Type": "application/json"
  }
});
api.interceptors.request.use((requestConfig) => {
  const apiKey = conf.get("apiKey");
  const model = conf.get("model");
  if (apiKey) {
    requestConfig.headers["X-API-Key"] = apiKey;
  }
  if (model) {
    requestConfig.headers["X-Model"] = model;
  }
  return requestConfig;
});
var LOGO = [
  " \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551\u255A\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D",
  "\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551   \u2588\u2588\u2551   ",
  "\u2588\u2588\u2551\u2584\u2584 \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551   ",
  "\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551   \u2588\u2588\u2551   ",
  " \u255A\u2550\u2550\u2580\u2580\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D   \u255A\u2550\u255D   "
];
var SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var ROOT_COMMANDS = ["/upload ", "/model ", "/key ", "/clear", "/exit"];
var MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-2.5-flash"];
var Logo = memo(() => /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", alignItems: "center" }, LOGO.map((line, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: "#06b6d4", bold: true }, line))));
function App() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("idle");
  const [uploadState, setUploadState] = useState({ status: "", jobId: "", result: null, error: null });
  const [output, setOutput] = useState([]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownItems, setDropdownItems] = useState([]);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const spinnerRef = useRef(null);
  const socketRef = useRef(null);
  const { setRawMode } = useStdin();
  const terminalHeight = useMemo(() => process.stdout.rows || 24, []);
  const activeModel = useMemo(() => conf.get("model") || "gemini-3-flash-preview", []);
  const filteredCommands = useMemo(() => {
    if (query.startsWith("/model ")) {
      const filter = query.replace("/model ", "").toLowerCase();
      return MODELS.filter((m) => m.toLowerCase().includes(filter));
    }
    if (query.startsWith("/")) {
      const filter = query.slice(1).toLowerCase();
      return ROOT_COMMANDS.filter((cmd) => cmd.replace("/", "").startsWith(filter));
    }
    return [];
  }, [query]);
  useEffect(() => {
    if (mode === "processing" || mode === "uploading") {
      spinnerRef.current = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    }
    return () => {
      if (spinnerRef.current) clearInterval(spinnerRef.current);
    };
  }, [mode]);
  useEffect(() => {
    socketRef.current = io("http://localhost:3000", {
      transports: ["websocket"],
      reconnection: true
    });
    socketRef.current.on("job_updated", (data) => {
      const { jobId, status, extractedData, errorMessage } = data;
      if (status === "completed") {
        setMode("result");
        setUploadState({ status: "completed", jobId, result: extractedData, error: null });
        addOutput("Job completed!", "green");
      } else if (status === "failed") {
        setMode("idle");
        setUploadState({ status: "failed", jobId, result: null, error: errorMessage });
        addOutput(`Job failed: ${errorMessage || "Unknown error"}`, "red");
      }
    });
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);
  const addOutput = (text, color = "white") => setOutput((prev) => [...prev, { text, color, id: Date.now() + Math.random() }]);
  useEffect(() => {
    if (query.startsWith("/model ") || query.startsWith("/")) {
      setDropdownItems(filteredCommands);
      setShowDropdown(filteredCommands.length > 0);
    } else {
      setShowDropdown(false);
    }
    setCursorIndex(0);
  }, [query, filteredCommands]);
  const selectFromDropdown = () => {
    const selected = filteredCommands[cursorIndex] || filteredCommands[0];
    if (selected) {
      const newValue = query.startsWith("/model ") ? "/model " + selected + " " : selected;
      setQuery(newValue);
      setShowDropdown(false);
    }
  };
  const executeCommand = () => {
    const trimmed = query.trim();
    if (trimmed.startsWith("/model ")) {
      const model = trimmed.replace("/model ", "").trim();
      if (model && MODELS.includes(model)) {
        conf.set("model", model);
        setQuery("");
        addOutput(`Model set to: ${model}`, "green");
      } else if (model) {
        addOutput(`Invalid model: ${model}`, "red");
      }
      return;
    }
    if (trimmed.startsWith("/key ")) {
      const key = trimmed.replace("/key ", "").trim();
      if (key) {
        conf.set("apiKey", key);
        setQuery("");
        addOutput("API key saved!", "green");
      }
      return;
    }
    if (trimmed === "/clear") {
      setQuery("");
      setOutput([]);
      addOutput("Terminal cleared", "gray");
      return;
    }
    if (trimmed === "/exit") {
      process.exit(0);
      return;
    }
    if (trimmed.startsWith("/upload ")) {
      const filePath = trimmed.replace("/upload ", "").trim();
      if (!filePath) {
        addOutput("Usage: /upload <path>", "red");
        return;
      }
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        addOutput(`File not found: ${resolvedPath}`, "red");
        return;
      }
      if (!conf.get("apiKey")) {
        addOutput("API key not set. Use /key <your-key>", "red");
        return;
      }
      setMode("uploading");
      setUploadState({ status: "uploading", jobId: "", result: null, error: null });
      setQuery("");
      const form = new FormData();
      form.append("document", fs.createReadStream(resolvedPath));
      form.append("model", conf.get("model"));
      api.post("/api/upload", form, { headers: form.getHeaders() }).then((res) => {
        const jobId = res.data.jobId;
        setMode("processing");
        setUploadState({ status: "processing", jobId, result: null, error: null });
        addOutput(`Uploading: ${filePath}`, "blue");
        addOutput(`Job ID: ${jobId}`, "yellow");
      }).catch((err) => {
        setMode("idle");
        addOutput(`Upload failed: ${err.message}`, "red");
      });
      return;
    }
    if (trimmed) addOutput(`Unknown command: ${trimmed}`, "red");
  };
  const returnToInput = () => {
    setMode("idle");
    setUploadState({ status: "", jobId: "", result: null, error: null });
    setOutput([]);
  };
  useEffect(() => {
    setRawMode(true);
    const handleData = (data) => {
      const buf = Buffer.from(data);
      if (mode === "result") {
        if (buf[0] === 27) {
          returnToInput();
        }
        return;
      }
      if (mode !== "idle") return;
      if (buf[0] === 3) {
        process.exit(0);
        return;
      }
      if (buf[0] === 27) {
        if (buf[1] === 91) {
          if (buf[2] === 65) {
            if (showDropdown && filteredCommands.length > 0) {
              setCursorIndex((prev) => prev > 0 ? prev - 1 : filteredCommands.length - 1);
            }
          } else if (buf[2] === 66) {
            if (showDropdown && filteredCommands.length > 0) {
              setCursorIndex((prev) => prev < filteredCommands.length - 1 ? prev + 1 : 0);
            }
          }
        } else if (buf[1] === void 0) {
          setShowDropdown(false);
        }
        return;
      }
      if (buf[0] === 127 || buf[0] === 8) {
        setQuery((prev) => prev.slice(0, -1));
        return;
      }
      if (buf[0] === 9) {
        if (showDropdown && filteredCommands.length > 0) {
          selectFromDropdown();
        }
        return;
      }
      if (buf[0] === 13 || buf[0] === 10) {
        if (showDropdown && filteredCommands.length > 0) {
          selectFromDropdown();
        } else {
          executeCommand();
        }
        return;
      }
      const char = buf.toString("utf8");
      if (char.length === 1 && char >= " " && char !== "\x7F") {
        setQuery((prev) => prev + char);
      }
    };
    process.stdin.on("data", handleData);
    return () => {
      process.stdin.removeListener("data", handleData);
      setRawMode(false);
    };
  }, [mode, showDropdown, filteredCommands, cursorIndex, query]);
  const renderInputBox = () => /* @__PURE__ */ React.createElement(Box, { width: 80, flexDirection: "column" }, /* @__PURE__ */ React.createElement(Box, { borderStyle: "round", borderColor: showDropdown ? "cyan" : "gray", backgroundColor: "#1E1B2E" }, /* @__PURE__ */ React.createElement(Text, { color: "gray" }, "\u258C"), /* @__PURE__ */ React.createElement(Box, { flexGrow: 1 }, /* @__PURE__ */ React.createElement(Text, { color: "white" }, query || "", /* @__PURE__ */ React.createElement(Text, { color: "gray" }, query ? "" : "Type / for commands...")))), showDropdown && filteredCommands.length > 0 && /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", marginTop: 1, borderStyle: "round", borderColor: "gray", backgroundColor: "#1E1B2E" }, filteredCommands.map((item, index) => /* @__PURE__ */ React.createElement(Box, { key: index, paddingX: 1, backgroundColor: index === cursorIndex ? "#06b6d4" : "transparent" }, /* @__PURE__ */ React.createElement(Text, { color: index === cursorIndex ? "black" : "gray", bold: index === cursorIndex }, index === cursorIndex ? "\u25B6 " : "  ", item)))));
  const renderProcessingBox = () => /* @__PURE__ */ React.createElement(Box, { width: 80, borderStyle: "round", borderColor: "yellow", backgroundColor: "#1E1B2E" }, /* @__PURE__ */ React.createElement(Text, { color: "yellow" }, SPINNER_FRAMES[spinnerFrame]), /* @__PURE__ */ React.createElement(Text, { color: "white" }, "  "), /* @__PURE__ */ React.createElement(Text, { color: "yellow" }, mode === "uploading" ? "Uploading..." : `Processing... Job ID: ${uploadState.jobId.substring(0, 8)}...`));
  const renderResultBox = () => /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width: 80, borderStyle: "round", borderColor: "green", backgroundColor: "#1E1B2E", paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { color: "green", bold: true }, "\u2713 Job Completed"), /* @__PURE__ */ React.createElement(Text, { color: "gray" }, "Job ID: ", uploadState.jobId), /* @__PURE__ */ React.createElement(Text, { color: "gray" }, "\u2500".repeat(50)), /* @__PURE__ */ React.createElement(Text, { color: "cyan" }, JSON.stringify(uploadState.result, null, 2)), /* @__PURE__ */ React.createElement(Text, { color: "gray" }, "\u2500".repeat(50)), /* @__PURE__ */ React.createElement(Text, { color: "gray" }, "Press Escape to return"));
  const StatusBar = memo(() => /* @__PURE__ */ React.createElement(Box, { width: 80, justifyContent: "space-between", marginTop: 1 }, /* @__PURE__ */ React.createElement(Text, { color: "cyan", bold: true }, "\u26A1 QueueBit Core"), /* @__PURE__ */ React.createElement(Text, { color: "magenta" }, "Model: ", activeModel), /* @__PURE__ */ React.createElement(Text, { color: "green" }, "Status: Online")));
  const Footer = memo(() => /* @__PURE__ */ React.createElement(Box, { width: "100%", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: 3 }, /* @__PURE__ */ React.createElement(Box, { width: "100%", flexDirection: "row", justifyContent: "flex-end" }, /* @__PURE__ */ React.createElement(Text, { color: "gray" }, "\u2191\u2193 navigate  Tab complete  Enter select")), /* @__PURE__ */ React.createElement(Box, { flexDirection: "row", alignItems: "center", marginTop: 1 }, /* @__PURE__ */ React.createElement(Text, { color: "yellow" }, "\u2022"), /* @__PURE__ */ React.createElement(Text, { color: "gray" }, "  Tip: Type /upload <path> to queue a document extraction"))));
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", alignItems: "center", width: "100%", height: terminalHeight, backgroundColor: "#13111C" }, /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", alignItems: "center", flexGrow: 1, justifyContent: "center" }, /* @__PURE__ */ React.createElement(Logo, null), /* @__PURE__ */ React.createElement(Box, { marginTop: 1 }, mode === "idle" && renderInputBox(), (mode === "uploading" || mode === "processing") && renderProcessingBox(), mode === "result" && renderResultBox()), /* @__PURE__ */ React.createElement(StatusBar, null)), mode === "idle" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width: 80, marginTop: 1, flexGrow: 1 }, output.slice(-15).map((item) => /* @__PURE__ */ React.createElement(Text, { key: item.id, color: item.color === "white" ? "#e4e4e7" : item.color === "green" ? "#22c55e" : item.color === "red" ? "#ef4444" : item.color === "yellow" ? "#f59e0b" : item.color === "blue" ? "#3b82f6" : "#71717a" }, item.text))), /* @__PURE__ */ React.createElement(Footer, null)));
}
export {
  App as default
};
