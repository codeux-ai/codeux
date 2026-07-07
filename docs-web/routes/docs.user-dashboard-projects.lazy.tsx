import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardProjectsContent from '../content/docs/user-dashboard-projects.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-projects')({
  component: () => (
    <DocsPage id="user-dashboard-projects">
      <UserDashboardProjectsContent />
    </DocsPage>
  )
})
