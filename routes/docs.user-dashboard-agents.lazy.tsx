import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardAgentsContent from '../content/docs/user-dashboard-agents.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-agents')({
  component: () => (
    <DocsPage id="user-dashboard-agents">
      <UserDashboardAgentsContent />
    </DocsPage>
  )
})
