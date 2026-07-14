import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardInternationalizationContent from '../content/docs/user-dashboard-internationalization.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-internationalization')({
  component: () => (
    <DocsPage id="user-dashboard-internationalization">
      <UserDashboardInternationalizationContent />
    </DocsPage>
  )
})
