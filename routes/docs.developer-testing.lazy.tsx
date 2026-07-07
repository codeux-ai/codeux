import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperTestingContent from '../content/docs/developer-testing.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-testing')({
  component: () => (
    <DocsPage id="developer-testing">
      <DeveloperTestingContent />
    </DocsPage>
  )
})
