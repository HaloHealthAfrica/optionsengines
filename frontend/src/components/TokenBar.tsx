import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, setToken } from '../services/apiClient';

export function TokenBar() {
  const [value, setValue] = useState(getToken() ?? '');
  const navigate = useNavigate();

  const handleSave = () => {
    setToken(value.trim());
  };

  const handleLogout = () => {
    setToken('');
    navigate('/login');
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
      <button 
        type="button" 
        onClick={handleLogout}
        style={{ 
          background: '#dc2626',
          marginLeft: '8px'
        }}
      >
        Logout
      </button>
    </div>
  );
}
