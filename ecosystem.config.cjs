module.exports = {
  apps: [
    {
      name: 'doce-casa-store',
      script: './server.js',
      cwd: '/opt/doce-casa-store',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'doce-casa-whatsapp',
      script: './whatsapp-service.js',
      cwd: '/opt/doce-casa-store',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '750M',
      restart_delay: 5000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
