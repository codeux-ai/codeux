import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardSprintsContent from '../content/docs/user-dashboard-sprints.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-sprints')({
  component: () => (
    <DocsPage id="user-dashboard-sprints">
      <UserDashboardSprintsContent />
    </DocsPage>
  )
})
