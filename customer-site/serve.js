const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 5500;
const FILE_PATH = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  fs.readFile(FILE_PATH, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Error loading customer test page');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Customer second-origin test website running at http://localhost:${PORT}`);
});

module.exports = server;
