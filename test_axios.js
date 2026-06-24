import axios from 'axios';
import FormData from 'form-data';
import * as http from 'http';

const server = http.createServer((req, res) => {
  console.log('Headers received:', req.headers['content-type']);
  res.writeHead(200);
  res.end('ok');
  server.close();
});

server.listen(3001, async () => {
  const httpClient = axios.create({
    headers: {
      'Content-Type': 'application/json'
    }
  });

  const form = new FormData();
  form.append('image', 'dummy data');

  try {
    // Send without overriding Content-Type
    await httpClient.post('http://localhost:3001', form);
  } catch (e) {
    console.error(e);
  }
});
