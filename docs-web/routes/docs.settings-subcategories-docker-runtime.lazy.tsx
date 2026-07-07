import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesDockerRuntimeContent from '../content/docs/settings-subcategories-docker-runtime.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-docker-runtime')({
  component: () => (
    <DocsPage id="settings-subcategories-docker-runtime">
      <SettingsSubcategoriesDockerRuntimeContent />
    </DocsPage>
  )
})
