workflow "Test ghpages" {
  on = "push"
  resolves = ["Deploy to GitHub Pages"]
}

action "Build Docs" {
  uses = "actions/bin/filter@master"
  args = "branch master"
}

action "Deploy to GitHub Pages" {
  needs = ["Build Docs"]
  uses = "./.github/docs"
  env = {
    BUILD_DIR = "website"
  }
  secrets = ["DEPLOY_SSH_KEY"]
}
