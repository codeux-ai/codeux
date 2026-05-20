/** @jsx h */
import { h, render } from "preact";
import { ChatThreadHeader } from "./v2/components/chat/ChatThreadHeader.js";
import "./styles.css";

import { buildMockChatThread, buildMockWorkerOption } from "../../tests/dashboard/factories/chat-fixture-factory.js";

const mockWorkerOptions = [
  buildMockWorkerOption({ id: "w1", label: "Worker 1", status: "online", isPrimary: true, type: "connection", isSelectable: true, connectionId: "w1" }),
  buildMockWorkerOption({ id: "w2", label: "Worker 2", status: "offline", isPrimary: false, type: "connection", isSelectable: true, connectionId: "w2" }),
];

const mockThreadActive = buildMockChatThread({
  id: "t1",
  projectId: "p1",
  title: "Active Thread Example",
  messageCount: 5,
  runtimeState: { sessionIds: ["s1"], replayRequired: false },
});

const mockThreadReplay = buildMockChatThread({
  id: "t2",
  projectId: "p1",
  title: "Replay Required Example",
  messageCount: 12,
  runtimeState: { sessionIds: ["s1"], replayRequired: true },
});

const mockThreadNew = buildMockChatThread({
  id: "t3",
  projectId: "p1",
  title: "New/Compacted Example",
  messageCount: 0,
  runtimeState: { sessionIds: [], replayRequired: false },
});

const App = () => (
  <div className="p-8 space-y-8 max-w-4xl mx-auto dark">
    <div className="border border-white/10 rounded-xl overflow-hidden bg-black dark:bg-void-900">
      <ChatThreadHeader
        thread={mockThreadActive}
        workerOptions={mockWorkerOptions}
        isAssigning={false}
        onAssignRoute={() => {}}
        onCompact={() => {}}
        isCompacting={false}
      />
    </div>
    <div className="border border-white/10 rounded-xl overflow-hidden bg-black dark:bg-void-900">
      <ChatThreadHeader
        thread={mockThreadReplay}
        workerOptions={mockWorkerOptions}
        isAssigning={false}
        onAssignRoute={() => {}}
        onCompact={() => {}}
        isCompacting={false}
      />
    </div>
    <div className="border border-white/10 rounded-xl overflow-hidden bg-black dark:bg-void-900">
      <ChatThreadHeader
        thread={mockThreadNew}
        workerOptions={mockWorkerOptions}
        isAssigning={false}
        onAssignRoute={() => {}}
        onCompact={() => {}}
        isCompacting={false}
      />
    </div>
  </div>
);

render(<App />, document.getElementById("app")!);
