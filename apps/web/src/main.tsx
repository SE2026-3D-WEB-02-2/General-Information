import React from 'react';
import ReactDOM from 'react-dom/client';
import { io } from 'socket.io-client';
import { AnnotationWorkspaceStore } from './app/annotation-store.ts';
import { FakeWorkspaceApi } from './adapters/fake-workspace-api.ts';
import { HttpAnnotationApi } from './adapters/http-annotation-api.ts';
import type { SocketLike } from './adapters/socket-realtime-adapter.ts';
import { CollaborationWorkspace } from './features/annotations/CollaborationWorkspace.tsx';
import { FakeViewportBridge } from './viewport/FakeViewportBridge.ts';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const mode = import.meta.env.VITE_DATA_MODE === 'live' ? 'live' : 'demo';
const modelId = import.meta.env.VITE_MODEL_ID || 'model-gltf-01';
const bridge = new FakeViewportBridge();
const store = new AnnotationWorkspaceStore(bridge);
const api = mode === 'live' ? new HttpAnnotationApi(apiBaseUrl) : new FakeWorkspaceApi();

function createSocket(token: string) {
  const socket = io(apiBaseUrl, { auth: { token } });
  return { socket: socket as unknown as SocketLike, disconnect: () => socket.disconnect() };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CollaborationWorkspace
      api={api}
      store={store}
      bridge={bridge}
      modelId={modelId}
      mode={mode}
      createSocket={mode === 'live' ? createSocket : undefined}
      onDemoPick={mode === 'demo' ? () => bridge.emitSurfacePick({
        position: [0.7, 1.1, 0.2], normal: [0, 1, 0],
        cameraState: { position: [3, 2, 4], target: [0.7, 1.1, 0.2] },
        meshName: 'Demo_Surface',
      }) : undefined}
    />
  </React.StrictMode>,
);
