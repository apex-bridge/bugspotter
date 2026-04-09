import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { ProjectIntegration } from '../../types/integration';

interface AddIntegrationDropdownProps {
  projectId: string;
  availableIntegrations: ProjectIntegration[];
  buttonText?: string;
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
}

export function AddIntegrationDropdown({
  projectId,
  availableIntegrations,
  buttonText = 'Add Integration',
  align = 'end',
  disabled,
}: AddIntegrationDropdownProps) {
  const navigate = useNavigate();

  if (availableIntegrations.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={disabled}>
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
          {buttonText}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        {availableIntegrations.map((integration) => (
          <DropdownMenuItem
            key={integration.platform}
            onClick={() =>
              navigate(`/projects/${projectId}/integrations/${integration.platform}/configure`)
            }
          >
            <div className="flex flex-col">
              <span className="font-medium">{integration.name}</span>
              <span className="text-xs text-gray-500">{integration.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
