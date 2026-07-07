import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardMemoryContent from '../content/docs/user-dashboard-memory.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-memory')({
  component: () => (
    <DocsPage id="user-dashboard-memory">
      <UserDashboardMemoryContent />
    </DocsPage>
  )
})
