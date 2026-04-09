import React, { useEffect } from 'react';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import type { ThrottleConfig } from '../../types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select-radix';

interface ThrottleConfigFormProps {
  config: ThrottleConfig | null;
  onChange: (config: ThrottleConfig | null) => void;
}

export function ThrottleConfigForm({ config, onChange }: ThrottleConfigFormProps) {
  const [enabled, setEnabled] = React.useState(!!config);
  const [localConfig, setLocalConfig] = React.useState<ThrottleConfig>(
    config || {
      max_per_hour: undefined,
      max_per_day: undefined,
      group_by: 'user',
      digest_mode: false,
      digest_interval_minutes: 60,
    }
  );

  // Synchronize internal state with prop changes (e.g., when editing a different rule)
  useEffect(() => {
    setEnabled(!!config);
    setLocalConfig(
      config || {
        max_per_hour: undefined,
        max_per_day: undefined,
        group_by: 'user',
        digest_mode: false,
        digest_interval_minutes: 60,
      }
    );
  }, [config]);

  const handleEnabledChange = (checked: boolean) => {
    setEnabled(checked);
    if (checked) {
      onChange(localConfig);
    } else {
      onChange(null);
    }
  };

  const handleConfigChange = (
    field: keyof ThrottleConfig,
    value: number | string | boolean | undefined
  ) => {
    const updated = { ...localConfig, [field]: value };
    setLocalConfig(updated);
    if (enabled) {
      onChange(updated);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Throttle Configuration</CardTitle>
            <CardDescription>Limit how often tickets are created to prevent spam</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="enable-throttle"
              checked={enabled}
              onCheckedChange={handleEnabledChange}
            />
            <Label htmlFor="enable-throttle" className="text-sm font-medium cursor-pointer">
              Enable Throttling
            </Label>
          </div>
        </div>
      </CardHeader>
      {enabled && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Max per hour */}
            <div className="space-y-2">
              <Label htmlFor="max-per-hour">
                Max Tickets Per Hour
                <span className="text-xs text-gray-500 ml-1">(optional)</span>
              </Label>
              <Input
                id="max-per-hour"
                type="number"
                min="1"
                value={localConfig.max_per_hour || ''}
                onChange={(e) =>
                  handleConfigChange(
                    'max_per_hour',
                    e.target.value ? parseInt(e.target.value, 10) : undefined
                  )
                }
                placeholder="e.g., 10"
              />
            </div>

            {/* Max per day */}
            <div className="space-y-2">
              <Label htmlFor="max-per-day">
                Max Tickets Per Day
                <span className="text-xs text-gray-500 ml-1">(optional)</span>
              </Label>
              <Input
                id="max-per-day"
                type="number"
                min="1"
                value={localConfig.max_per_day || ''}
                onChange={(e) =>
                  handleConfigChange(
                    'max_per_day',
                    e.target.value ? parseInt(e.target.value, 10) : undefined
                  )
                }
                placeholder="e.g., 100"
              />
            </div>
          </div>

          {/* Group by */}
          <div className="space-y-2">
            <Label htmlFor="group-by">Group By</Label>
            <Select
              value={localConfig.group_by || 'user'}
              onValueChange={(value) =>
                handleConfigChange('group_by', value as 'user' | 'url' | 'error_type')
              }
            >
              <SelectTrigger id="group-by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="url">URL</SelectItem>
                <SelectItem value="error_type">Error Type</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">Group bug reports when counting throttle limits</p>
          </div>

          {/* Digest mode */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="digest-mode"
                checked={localConfig.digest_mode || false}
                onCheckedChange={(checked) => handleConfigChange('digest_mode', checked === true)}
              />
              <Label htmlFor="digest-mode" className="text-sm font-normal cursor-pointer">
                Enable Digest Mode
              </Label>
            </div>
            <p className="text-xs text-gray-500">
              Batch multiple reports into a single ticket instead of creating individual tickets
            </p>

            {localConfig.digest_mode && (
              <div className="space-y-2 pl-6">
                <Label htmlFor="digest-interval">Digest Interval (minutes)</Label>
                <Input
                  id="digest-interval"
                  type="number"
                  min="1"
                  max="1440"
                  value={localConfig.digest_interval_minutes || 60}
                  onChange={(e) =>
                    handleConfigChange(
                      'digest_interval_minutes',
                      e.target.value ? parseInt(e.target.value, 10) : 60
                    )
                  }
                />
                <p className="text-xs text-gray-500">
                  How often to send digest updates (1-1440 minutes)
                </p>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
