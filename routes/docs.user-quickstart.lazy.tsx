import { createLazyFileRoute } from '@tanstack/react-router'
import UserQuickstartContent from '../content/docs/user-quickstart.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-quickstart')({
  component: () => (
    <DocsPage id="user-quickstart">
      <UserQuickstartContent />
    </DocsPage>
  )
})
