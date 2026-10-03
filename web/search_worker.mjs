import {search_cycles} from './core.mjs?v=shared-quotes-v1';

self.onmessage = ({data}) => {
  try {
    self.postMessage(search_cycles(data.league, data.options));
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
