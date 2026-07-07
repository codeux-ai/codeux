import { createLazyFileRoute } from '@tanstack/react-router'
import UserProvidersAndModelsContent from '../content/docs/user-providers-and-models.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-providers-and-models')({
  component: () => (
    <DocsPage id="user-providers-and-models">
      <UserProvidersAndModelsContent />
    </DocsPage>
  )
})
