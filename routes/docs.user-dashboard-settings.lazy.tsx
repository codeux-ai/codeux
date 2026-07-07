import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardSettingsContent from '../content/docs/user-dashboard-settings.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-settings')({
  component: () => (
    <DocsPage id="user-dashboard-settings">
      <UserDashboardSettingsContent />
    </DocsPage>
  )
})
