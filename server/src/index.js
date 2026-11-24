import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const [{ default: express }, { default: cors }, { checkDb }, registry] =
  await Promise.all([import('express'), import('cors'), import('./db.js'), import('./registry.js')]);
await registry.loadModules();
const { default: chatRouter } = await import('./routes/chat.js');
const { requireUser } = await import('./modules/auth/index.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Akanksha_AI', time: new Date().toISOString() });
});

app.get('/api/health/db', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await checkDb()) });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Everything under /api needs a signed-in user except health checks and the auth routes themselves.
app.use('/api', (req, res, next) => (req.path.startsWith('/health') || req.path.startsWith('/modules/auth') ? next() : requireUser(req, res, next)));

app.use('/api/chat', chatRouter);
registry.mountRoutes(app);

app.get('/api/modules', (req, res) => res.json({ modules: registry.listModules() }));

app.listen(PORT, () => {
  console.log(`Akanksha_AI server running on http://localhost:${PORT}`);
});
