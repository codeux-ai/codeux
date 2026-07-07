import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardLiveSessionContent from '../content/docs/user-dashboard-live-session.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-live-session')({
  component: () => (
    <DocsPage id="user-dashboard-live-session">
      <UserDashboardLiveSessionContent />
    </DocsPage>
  )
})
