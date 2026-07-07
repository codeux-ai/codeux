import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardNodesContent from '../content/docs/user-dashboard-nodes.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-nodes')({
  component: () => (
    <DocsPage id="user-dashboard-nodes">
      <UserDashboardNodesContent />
    </DocsPage>
  )
})
