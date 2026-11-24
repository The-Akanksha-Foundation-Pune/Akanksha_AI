// Export module: turns an answer into a Word document. Routes only, no tools.
import router from './docx.js';

export default {
  name: 'export',
  order: 90,
  routes: router,
};
