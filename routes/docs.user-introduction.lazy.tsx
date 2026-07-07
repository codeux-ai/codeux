import { createLazyFileRoute } from '@tanstack/react-router'
import UserIntroductionContent from '../content/docs/user-introduction.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-introduction')({
  component: () => (
    <DocsPage id="user-introduction">
      <UserIntroductionContent />
    </DocsPage>
  )
})
