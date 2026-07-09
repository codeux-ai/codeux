import { createLazyFileRoute } from '@tanstack/react-router'
import UserQuicksprintsContent from '../content/docs/user-quicksprints.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-quicksprints')({
  component: () => (
    <DocsPage id="user-quicksprints">
      <UserQuicksprintsContent />
    </DocsPage>
  )
})
