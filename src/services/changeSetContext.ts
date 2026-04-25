import { AsyncLocalStorage } from 'async_hooks';

export const changeSetContext = new AsyncLocalStorage<string>();
