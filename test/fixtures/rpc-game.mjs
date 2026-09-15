// A minimal "engine" speaking the playtest bridge protocol: newline-delimited
// JSON over TCP, request/response. This is the whole surface a real game has to
// implement — it is deliberately small, because that is the argument for the
// protocol.
//
// Usage: node rpc-game.mjs <port>
import { createServer } from 'node:net';

const port = Number(process.argv[2] ?? 0);

let hp = 40;
let turn = 0;
let room = 'Chapel Nave';
let done = false;

const observation = () => ({
  text: `${room}\nHP ${hp}/100 — turn ${turn}\nExits: nave, alcove.`,
  state: { room, hp, turn, exits: ['nave', 'alcove'] },
  actions: {
    kind: 'choice',
    options: [
      { id: 'attack', label: 'Attack the thing in the dark' },
      { id: 'flee', label: 'Back out the way you came' },
      { id: 'look', label: 'Look around' },
    ],
  },
  done,
});

const server = createServer((socket) => {
  socket.setEncoding('utf8');
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.method === 'hello') {
        socket.write(JSON.stringify({ id: msg.id, result: { protocol: 1, game: 'echo-chapel', capabilities: ['observe', 'act', 'reset', 'quit'] } }) + '\n');
      } else if (msg.method === 'reset') {
        hp = 40; turn = 0; room = 'Chapel Nave'; done = false;
        socket.write(JSON.stringify({ id: msg.id, result: observation() }) + '\n');
      } else if (msg.method === 'observe') {
        socket.write(JSON.stringify({ id: msg.id, result: observation() }) + '\n');
      } else if (msg.method === 'act') {
        const id = msg.params?.id ?? msg.params?.name ?? msg.params?.line ?? '';
        // Deliberately never replies, to exercise the harness's request
        // timeout and its close-while-pending handling.
        if (id === 'silent') continue;
        turn++;
        if (id === 'attack') { hp -= 10; }
        else if (id === 'flee') { room = room === 'Chapel Nave' ? 'Alcove' : 'Chapel Nave'; }
        else if (id === 'boom') {
          socket.write(JSON.stringify({ id: msg.id, error: { message: 'the game blew up' } }) + '\n');
          continue;
        }
        if (hp <= 0) done = true;
        socket.write(JSON.stringify({ id: msg.id, result: observation() }) + '\n');
      } else if (msg.method === 'quit') {
        socket.write(JSON.stringify({ id: msg.id, result: { ...observation(), done: true } }) + '\n');
        socket.end();
        server.close();
      } else if (msg.method === 'silent') {
        // Deliberately never replies, to exercise the request timeout.
      }
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  // The harness reads this line to learn the port when it spawns the game.
  process.stdout.write(`PLAYTEST_BRIDGE_PORT=${server.address().port}\n`);
});
