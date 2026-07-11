import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardNodesCanvasContent from '../content/docs/user-dashboard-nodes-canvas.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-nodes-canvas')({
  component: () => (
    <DocsPage id="user-dashboard-nodes-canvas">
      <UserDashboardNodesCanvasContent />
    </DocsPage>
  )
})
