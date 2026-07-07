import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperHttpApiContent from '../content/docs/developer-http-api.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-http-api')({
  component: () => (
    <DocsPage id="developer-http-api">
      <DeveloperHttpApiContent />
    </DocsPage>
  )
})
