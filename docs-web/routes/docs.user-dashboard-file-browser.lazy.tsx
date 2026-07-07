import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardFileBrowserContent from '../content/docs/user-dashboard-file-browser.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-file-browser')({
  component: () => (
    <DocsPage id="user-dashboard-file-browser">
      <UserDashboardFileBrowserContent />
    </DocsPage>
  )
})
