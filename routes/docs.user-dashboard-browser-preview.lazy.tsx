import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardBrowserPreviewContent from '../content/docs/user-dashboard-browser-preview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-browser-preview')({
  component: () => (
    <DocsPage id="user-dashboard-browser-preview">
      <UserDashboardBrowserPreviewContent />
    </DocsPage>
  )
})
