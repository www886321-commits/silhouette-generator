import { removeBackground } from '@imgly/background-removal';
import { progressMessage } from './segmentation';

self.postMessage({ ready: true });

self.addEventListener('message', async (event: MessageEvent) => {
  const { id, input, config } = event.data;
  try {
    const blob = await removeBackground(input, {
      ...config,
      progress: (key: string, current: number, total: number) => self.postMessage({ id, progress: progressMessage(key, current, total) }),
    });
    self.postMessage({ id, blob });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
