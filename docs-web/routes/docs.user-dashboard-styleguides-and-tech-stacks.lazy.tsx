import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardStyleguidesAndTechStacksContent from '../content/docs/user-dashboard-styleguides-and-tech-stacks.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-styleguides-and-tech-stacks')({
  component: () => (
    <DocsPage id="user-dashboard-styleguides-and-tech-stacks">
      <UserDashboardStyleguidesAndTechStacksContent />
    </DocsPage>
  )
})
