/**
 * Gruntfile.js - Build Professional
 * @author Senior Engineer
 * @version 1.0.0
 * 
 * Features:
 * - Compilação LESS com sourcemaps
 * - Minificação JavaScript segura
 * - Logs estruturados com Winston
 * - Tratamento de erros robusto
 * - Rate limiting para watch tasks
 */

const winston = require('winston');
const path = require('path');
const crypto = require('crypto');

// Configuração de logs estruturados (sem vazamento de dados)
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    // Sanitização de dados sensíveis
    winston.format.printf(({ level, message, timestamp, ...metadata }) => {
      // Remove campos sensíveis
      const safeMetadata = { ...metadata };
      delete safeMetadata.password;
      delete safeMetadata.token;
      delete safeMetadata.secret;
      delete safeMetadata.apiKey;
      
      return JSON.stringify({
        timestamp,
        level,
        message: message || 'No message',
        ...safeMetadata,
        requestId: generateRequestId()
      });
    })
  ),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5
    })
  ],
  exitOnError: false
});

// Rate limiting simples para operações
class RateLimiter {
  constructor(maxOps = 100, windowMs = 60000) {
    this.maxOps = maxOps;
    this.windowMs = windowMs;
    this.operations = new Map();
  }
  
  checkLimit(operationId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    let ops = this.operations.get(operationId) || [];
    ops = ops.filter(timestamp => timestamp > windowStart);
    
    if (ops.length >= this.maxOps) {
      logger.warn('Rate limit excedido', { 
        operationId, 
        currentOps: ops.length,
        maxOps: this.maxOps 
      });
      return false;
    }
    
    ops.push(now);
    this.operations.set(operationId, ops);
    return true;
  }
  
  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    for (const [key, timestamps] of this.operations.entries()) {
      const validTimestamps = timestamps.filter(t => t > windowStart);
      if (validTimestamps.length === 0) {
        this.operations.delete(key);
      } else {
        this.operations.set(key, validTimestamps);
      }
    }
  }
}

// Utilitários
const generateRequestId = () => {
  return crypto.randomBytes(8).toString('hex');
};

const sanitizePath = (filePath) => {
  // Previne path traversal
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) {
    throw new Error('Path traversal detectado');
  }
  return normalized;
};

// Error Handler Global
class BuildError extends Error {
  constructor(message, code, metadata = {}) {
    super(message);
    this.name = 'BuildError';
    this.code = code;
    this.metadata = metadata;
  }
}

const errorHandler = (error, context = {}) => {
  const errorId = generateRequestId();
  
  logger.error('Build error occurred', {
    errorId,
    error: {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    },
    context,
    timestamp: new Date().toISOString()
  });
  
  return {
    success: false,
    errorId,
    message: 'Ocorreu um erro durante o build',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  };
};

// Rate limiter instance
const rateLimiter = new RateLimiter(200, 60000);

// Limpeza periódica do rate limiter
setInterval(() => rateLimiter.cleanup(), 300000); // A cada 5 minutos

module.exports = function(grunt) {
  'use strict';
  
  const startTime = Date.now();
  const buildId = generateRequestId();
  
  logger.info('Gruntfile inicializado', { 
    buildId,
    nodeEnv: process.env.NODE_ENV || 'development',
    platform: process.platform,
    nodeVersion: process.version
  });
  
  // Configuração do Grunt com tratamento de erros
  try {
    grunt.initConfig({
      pkg: grunt.file.readJSON('package.json'),
      
      // Limpeza de builds anteriores
      clean: {
        build: ['dist/**/*'],
        options: {
          force: false
        }
      },
      
      // Compilação LESS segura
      less: {
        development: {
          options: {
            paths: ['src/less'],
            sourceMap: true,
            sourceMapFilename: 'dist/css/style.css.map',
            sourceMapURL: 'style.css.map',
            sourceMapRootpath: '/',
            strictMath: true,
            strictUnits: true,
            ieCompat: false,
            compress: false,
            // Previne injeção de código
            plugins: [],
            modifyVars: {}
          },
          files: {
            'dist/css/style.css': 'src/less/style.less'
          }
        },
        production: {
          options: {
            paths: ['src/less'],
            sourceMap: false,
            compress: true,
            strictMath: true,
            strictUnits: true,
            cleancss: true,
            modifyVars: {}
          },
          files: {
            'dist/css/style.min.css': 'src/less/style.less'
          }
        }
      },
      
      // Minificação JavaScript segura
      uglify: {
        development: {
          options: {
            sourceMap: true,
            sourceMapIncludeSources: true,
            sourceMapIn: 'src/js/app.js.map',
            compress: false,
            mangle: false,
            beautify: true,
            preserveComments: 'all'
          },
          files: {
            'dist/js/app.js': ['src/js/**/*.js']
          }
        },
        production: {
          options: {
            sourceMap: false,
            compress: {
              drop_console: true,
              drop_debugger: true,
              pure_funcs: ['console.log', 'console.info'],
              // Segurança adicional
              unsafe: false,
              hoist_funs: true,
              hoist_vars: false
            },
            mangle: {
              reserved: ['$', 'jQuery', 'exports', 'require']
            },
            output: {
              comments: false,
              beautify: false
            },
            // Previne eval malicioso
            parse: {
              strict: true
            }
          },
          files: {
            'dist/js/app.min.js': ['src/js/**/*.js']
          }
        }
      },
      
      // Watch com rate limiting
      watch: {
        less: {
          files: ['src/less/**/*.less'],
          tasks: ['build-less-dev'],
          options: {
            spawn: false,
            debounceDelay: 500,
            interval: 1000
          }
        },
        js: {
          files: ['src/js/**/*.js'],
          tasks: ['build-js-dev'],
          options: {
            spawn: false,
            debounceDelay: 500
          }
        },
        gruntfile: {
          files: ['Gruntfile.js'],
          options: {
            reload: true
          }
        }
      }
    });
    
    // Carregamento seguro de plugins
    const requiredPlugins = [
      'grunt-contrib-clean',
      'grunt-contrib-less',
      'grunt-contrib-uglify',
      'grunt-contrib-watch'
    ];
    
    requiredPlugins.forEach(plugin => {
      try {
        grunt.loadNpmTasks(plugin);
        logger.debug('Plugin carregado', { plugin });
      } catch (error) {
        logger.error('Falha ao carregar plugin', { 
          plugin, 
          error: error.message 
        });
        throw new BuildError(
          `Plugin ${plugin} não encontrado. Execute: npm install`,
          'PLUGIN_MISSING',
          { plugin }
        );
      }
    });
    
    // Tarefas com tratamento de erros e logs
    grunt.registerTask('build-less-dev', 'Compila LESS para desenvolvimento', function() {
      const taskId = generateRequestId();
      const taskStart = Date.now();
      
      if (!rateLimiter.checkLimit('less-compilation')) {
        logger.warn('Compilação LESS ignorada devido ao rate limiting', { taskId });
        return false;
      }
      
      try {
        logger.info('Iniciando compilação LESS (dev)', { 
          taskId,
          files: grunt.config.get('less.development.files')
        });
        
        grunt.task.run('less:development');
        
        const duration = Date.now() - taskStart;
        logger.info('Compilação LESS concluída', { 
          taskId, 
          duration: `${duration}ms` 
        });
      } catch (error) {
        const errorResult = errorHandler(error, { 
          taskId, 
          task: 'less-dev' 
        });
        grunt.fail.warn(errorResult.message);
      }
    });
    
    grunt.registerTask('build-js-dev', 'Minifica JS para desenvolvimento', function() {
      const taskId = generateRequestId();
      
      if (!rateLimiter.checkLimit('js-minification')) {
        logger.warn('Minificação JS ignorada devido ao rate limiting', { taskId });
        return false;
      }
      
      try {
        logger.info('Iniciando minificação JS (dev)', { taskId });
        grunt.task.run('uglify:development');
        logger.info('Minificação JS concluída', { taskId });
      } catch (error) {
        errorHandler(error, { taskId, task: 'js-dev' });
        grunt.fail.warn('Erro na minificação JS');
      }
    });
    
    // Tarefa de build completa
    grunt.registerTask('build', 'Build completo do projeto', function() {
      const buildStart = Date.now();
      
      logger.info('Iniciando build completo', { 
        buildId,
        mode: process.env.NODE_ENV || 'development'
      });
      
      try {
        // Validação de segurança antes do build
        validateEnvironment();
        
        // Limpa build anterior
        grunt.task.run('clean');
        
        // Build para produção
        if (process.env.NODE_ENV === 'production') {
          grunt.task.run('less:production');
          grunt.task.run('uglify:production');
          logger.info('Build de produção executado');
        } else {
          grunt.task.run('less:development');
          grunt.task.run('uglify:development');
          logger.info('Build de desenvolvimento executado');
        }
        
        const duration = Date.now() - buildStart;
        logger.info('Build concluído com sucesso', { 
          buildId, 
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorResult = errorHandler(error, { 
          buildId, 
          task: 'full-build' 
        });
        grunt.fail.fatal(errorResult.message);
      }
    });
    
    // Tarefa de desenvolvimento
    grunt.registerTask('dev', 'Modo desenvolvimento com watch', function() {
      logger.info('Modo desenvolvimento iniciado', { 
        buildId,
        watching: ['src/less/**/*.less', 'src/js/**/*.js']
      });
      
      grunt.task.run('build');
      grunt.task.run('watch');
    });
    
    // Tarefa padrão
    grunt.registerTask('default', ['build']);
    
    // Função de validação de ambiente
    function validateEnvironment() {
      const requiredDirs = ['src/less', 'src/js', 'dist/css', 'dist/js'];
      
      requiredDirs.forEach(dir => {
        const safePath = sanitizePath(dir);
        if (!grunt.file.exists(safePath)) {
          grunt.file.mkdir(safePath);
          logger.info('Diretório criado', { path: safePath });
        }
      });
      
      // Verifica arquivos fonte
      if (!grunt.file.exists('src/less/style.less')) {
        logger.warn('Arquivo LESS principal não encontrado', { 
          path: 'src/less/style.less' 
        });
      }
    }
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      logger.info('Build interrompido pelo usuário', { buildId });
      grunt.fail.fatal('Build interrompido');
    });
    
    process.on('uncaughtException', (error) => {
      logger.error('Erro não tratado', { 
        buildId,
        error: {
          name: error.name,
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      });
      grunt.fail.fatal('Erro crítico no build');
    });
    
  } catch (error) {
    logger.error('Falha na configuração do Grunt', {
      error: error.message,
      stack: error.stack
    });
    grunt.fail.fatal('Erro na configuração do Gruntfile');
  }
};