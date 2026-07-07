import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardTasksContent from '../content/docs/user-dashboard-tasks.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-tasks')({
  component: () => (
    <DocsPage id="user-dashboard-tasks">
      <UserDashboardTasksContent />
    </DocsPage>
  )
})
