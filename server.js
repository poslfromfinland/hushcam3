const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/host", (req, res) => res.sendFile(path.join(__dirname, "public", "host.html")));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const HOST_KEY = process.env.HOST_KEY || ""; // set this in production
let host = null, hostName = "hush_user", hostImg = "", counter = 0;
const pair = new Map(); // host <-> private guest

const clean = (s, n = 200) => String(s || "").slice(0, n);
const send = (c, o) => { if (c && c.readyState === 1) c.send(JSON.stringify(o)); };
const broadcast = (o, except) => wss.clients.forEach(c => { if (c !== except) send(c, o); });
const users = () => [...wss.clients].filter(c => c.joined && c !== host && c.readyState === 1).map(c => c.name);
const pushUsers = () => broadcast({ t: "users", list: users() });

wss.on("connection", ws => {
  ws.id = String(++counter);
  ws.name = "viewer";
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== "string") return;

    if (m.t === "hello") {
      ws.name = clean(m.name, 20) || "viewer";
      ws.sn = /^HC-\d{5}-\d{5}-\d{5}$/.test(m.sn) ? m.sn : "HC-00000-00000-" + String(ws.id).padStart(5, "0");
      if (m.role === "host" && (!HOST_KEY || m.key === HOST_KEY)) {
        host = ws; hostName = ws.name; broadcast({ t: "host", name: hostName }, ws);
      } else {
        send(ws, { t: "host", name: hostName });
        if (hostImg) send(ws, { t: "avatar", img: hostImg });
      }
      ws.joined = true;
      if (m.role === "host" && ws !== host) send(ws, { t: "denied" });
      pushUsers();
      return;
    }
    if (m.t === "name") {
      ws.name = clean(m.name, 20) || ws.name;
      if (ws === host) { hostName = ws.name; broadcast({ t: "host", name: hostName }, ws); }
      pushUsers();
      return;
    }
    if (m.t === "avatar" && ws === host) {
      const img = String(m.img || "");
      if (img === "" || (/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(img) && img.length < 120000)) {
        hostImg = img; broadcast({ t: "avatar", img }, ws);
      }
      return;
    }
    if (m.t === "chat") return broadcast({ t: "chat", name: ws.name, text: clean(m.text) }, ws);
    if (m.t === "tip") {
      const a = Math.min(Math.max(+m.amt || 0, 1), 1000);
      wss.clients.forEach(c => {
        if (c !== ws) send(c, c === host ? { t: "tip", name: ws.name, amt: a, sn: ws.sn } : { t: "tip", name: ws.name, amt: a });
      });
      return;
    }
    if (m.t === "pvreq" && host) {
      ws.price = Math.min(Math.max(Math.floor(+m.price) || 500, 1), 5000);
      return send(host, { t: "pvreq", id: ws.id, name: ws.name, price: ws.price, sn: ws.sn });
    }
    if (m.t === "pvacc" && ws === host) {
      const g = [...wss.clients].find(c => c.id === String(m.to));
      if (g) { pair.set(host, g); pair.set(g, host); send(g, { t: "pvacc", name: hostName, price: g.price || 500 }); }
      return;
    }
    if (m.t === "pm") return send(pair.get(ws), { t: "pm", text: clean(m.text) });
    if (m.t === "pvend") {
      const o = pair.get(ws); send(o, { t: "pvend" }); pair.delete(ws); pair.delete(o);
    }
  });
  ws.on("close", () => {
    const o = pair.get(ws);
    if (o) { send(o, { t: "pvend" }); pair.delete(o); }
    pair.delete(ws);
    if (ws === host) host = null;
    pushUsers();
  });
});

server.listen(process.env.PORT || 3000, () => console.log("HushCam is running"));
