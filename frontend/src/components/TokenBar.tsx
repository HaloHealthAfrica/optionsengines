import { useState } from 'react';
import { getToken, setToken } from '../services/apiClient';

export function TokenBar() {
  const [value, setValue] = useState(getToken() ?? '');

  const handleSave = () => {
    setToken(value.trim());
  };

  return (
    <div className="token-bar">
      <label htmlFor="token-input">API Token</label>
      <input
        id="token-input"
        type="password"
        placeholder="Paste JWT token"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="button" onClick={handleSave}>
        Save
      </button>
    </div>
  );
}
