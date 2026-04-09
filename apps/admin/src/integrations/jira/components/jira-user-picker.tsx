import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, User, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { jiraUserService, type JiraUser } from '../services/jira-user-service';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { useDebounce } from '../../../hooks/use-debounce';

// ============================================================================
// CONSTANTS
// ============================================================================

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 3;

interface JiraUserPickerProps {
  projectId: string;
  value: string | null; // JSON string: { "accountId": "..." } or null
  onChange: (value: string | null) => void;
  placeholder?: string;
  'data-testid'?: string;
}

/**
 * Jira user picker with autocomplete
 * Searches by email or display name, stores accountId
 */
export function JiraUserPicker({
  projectId,
  value,
  onChange,
  placeholder = 'Search by email or name...',
  'data-testid': dataTestId,
}: JiraUserPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedUser, setSelectedUser] = useState<JiraUser | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search query to prevent excessive API calls
  const debouncedSearchQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);

  // Parse current value to display selected user
  // Always sync selectedUser with value prop to prevent stale UI
  useEffect(() => {
    if (value) {
      try {
        const parsed = JSON.parse(value);
        if (parsed.accountId) {
          setSelectedUser({
            accountId: parsed.accountId,
            displayName: parsed.displayName || parsed.accountId, // Fallback to accountId if displayName missing
            emailAddress: parsed.emailAddress,
            avatarUrls: parsed.avatarUrls,
          });
        } else {
          setSelectedUser(null); // Invalid format (missing accountId)
        }
      } catch {
        setSelectedUser(null); // Invalid JSON - clear stale selection
      }
    } else {
      setSelectedUser(null);
    }
  }, [value]);

  // Debounced user search - minimum characters required
  const { data: users, isLoading } = useQuery({
    queryKey: ['jira-users', projectId, debouncedSearchQuery],
    queryFn: () => jiraUserService.searchUsers(projectId, debouncedSearchQuery),
    enabled: debouncedSearchQuery.length >= MIN_SEARCH_LENGTH && showDropdown,
    staleTime: 60000, // 1 minute cache
  });

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectUser = useCallback(
    (user: JiraUser) => {
      setSelectedUser(user);
      setSearchQuery('');
      setShowDropdown(false);
      // Store as JSON string for form state (rules.tsx parses it back to object for JSONB storage)
      onChange(
        JSON.stringify({
          accountId: user.accountId,
          displayName: user.displayName,
          emailAddress: user.emailAddress,
          avatarUrls: user.avatarUrls,
        })
      );
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    setSelectedUser(null);
    setSearchQuery('');
    onChange(null);
    inputRef.current?.focus();
  }, [onChange]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    setShowDropdown(query.length >= MIN_SEARCH_LENGTH);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {selectedUser ? (
        <div className="flex items-center gap-2 p-2 border rounded-md bg-gray-50">
          {selectedUser.avatarUrls?.['24x24'] ? (
            <img
              src={selectedUser.avatarUrls['24x24']}
              alt=""
              className="w-6 h-6 rounded-full"
              aria-hidden="true"
            />
          ) : (
            <User className="w-6 h-6 text-gray-400" aria-hidden="true" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedUser.displayName}</p>
            {selectedUser.emailAddress && (
              <p className="text-xs text-gray-500 truncate">{selectedUser.emailAddress}</p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
              aria-hidden="true"
            />
            <Input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={handleInputChange}
              onFocus={() => searchQuery.length >= MIN_SEARCH_LENGTH && setShowDropdown(true)}
              placeholder={placeholder}
              className="pl-10"
              aria-label="Search for Jira user"
              aria-autocomplete="list"
              aria-expanded={showDropdown}
              data-testid={dataTestId}
            />
          </div>

          {showDropdown && (
            <div
              role="listbox"
              className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto"
            >
              {debouncedSearchQuery.length < MIN_SEARCH_LENGTH && (
                <div className="p-3 text-sm text-gray-500">
                  Type at least {MIN_SEARCH_LENGTH} characters to search...
                </div>
              )}

              {debouncedSearchQuery.length >= MIN_SEARCH_LENGTH && isLoading && (
                <div className="p-3 text-sm text-gray-500">Searching...</div>
              )}

              {debouncedSearchQuery.length >= MIN_SEARCH_LENGTH &&
                !isLoading &&
                users &&
                users.length === 0 && (
                  <div className="p-3 text-sm text-gray-500">
                    No users found. Try searching by email or name.
                  </div>
                )}

              {debouncedSearchQuery.length >= MIN_SEARCH_LENGTH &&
                !isLoading &&
                users &&
                users.map((user) => (
                  <button
                    key={user.accountId}
                    type="button"
                    role="option"
                    onClick={() => handleSelectUser(user)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    {user.avatarUrls?.['24x24'] ? (
                      <img
                        src={user.avatarUrls['24x24']}
                        alt=""
                        className="w-8 h-8 rounded-full flex-shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-gray-500" aria-hidden="true" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{user.displayName}</p>
                      {user.emailAddress && (
                        <p className="text-xs text-gray-500 truncate">{user.emailAddress}</p>
                      )}
                    </div>
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
