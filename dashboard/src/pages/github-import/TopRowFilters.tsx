import { h } from 'preact';
import { MultiSelect } from '../../components/ui/MultiSelect.js';

interface TopRowFiltersProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  availableTags: { value: string; label: string }[];
}

export function TopRowFilters({ selectedTags, onTagsChange, availableTags }: TopRowFiltersProps) {
  return (
    <div className="flex w-full items-center gap-4 py-3">
      <div className="flex-1">
        <MultiSelect
          options={availableTags}
          value={selectedTags}
          onChange={onTagsChange}
          placeholder="Filter by GitHub tags..."
        />
      </div>
    </div>
  );
}
