pipeline {
  agent any
  options {
    skipDefaultCheckout(true)
  }

  environment {
    IMAGE_NAME = 'app:ec2'
    TAR_NAME = 'app-ec2.tar.gz'
    REMOTE_HOST = '...'
    REMOTE_USER = 'ec2-user'
    REMOTE_APPDIR = '/opt/app'
    REPO_URL = 'git@github-parent:gprice1129/web-chatbot-prototype.git'
    BRANCH_NAME = 'main'
  }

  stages {
    stage('Clone manually') {
      steps {
        withCredentials([
          sshUserPrivateKey(credentialsId: 'gh-chatbot', keyFileVariable: 'PARENT_KEY'),
          sshUserPrivaryKey(credentialsId: 'gh-webserver', keyFileVariable: 'SUB_KEY')
        ]) {
          sh '''
            set -euxo pipefail

            rm -rf repo
            mkdir -p ~/.ssh
            chmod 700 ~/.ssh

            cat > ~/.ssh/config <<EOF
Host github-parent
  HostName github.com
  User git
  IdentityFile $PARENT_KEY
  IdentitiesOnly yes

Host github-sub
  HostName github.com
  User git
  IdentityFile $SUB_KEY
  IdentitiesOnly yes
EOF
              chmod 600 ~/.ssh/config

              git clone --branch "$BRANCH_NAME" "$REPO_URL" repo
              cd repo

              git submodule sync --recursive
              git submodule update --init --recursive
            '''
        }
      }
    }

    stage('Build image') {
      steps {
        dir('repo/webserver') {
          sh '''
            set -euxo pipefail
            docker build -t "$IMAGE_NAME" .
          '''
        }
      }
    }

    stage('Export image') {
      steps {
        sh '''
          set -euxo pipefail
          docker image save "$IMAGE_NAME" | gzip > "$TAR_NAME" 
        '''
      }
    }
  }
}
