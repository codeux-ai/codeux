import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardNodeFlowsContent from '../content/docs/user-dashboard-node-flows.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-node-flows')({
  component: () => (
    <DocsPage id="user-dashboard-node-flows">
      <UserDashboardNodeFlowsContent />
    </DocsPage>
  )
})
