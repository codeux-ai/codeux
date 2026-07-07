import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperWebsocketRealtimeContent from '../content/docs/developer-websocket-realtime.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-websocket-realtime')({
  component: () => (
    <DocsPage id="developer-websocket-realtime">
      <DeveloperWebsocketRealtimeContent />
    </DocsPage>
  )
})
