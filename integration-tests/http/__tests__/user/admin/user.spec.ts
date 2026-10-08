import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { IAuthModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils"
import {
  adminHeaders,
  createAdminUser,
} from "../../../../helpers/create-admin-user"

jest.setTimeout(30000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api, dbUtils }) => {
    let user, container, authIdentity

    beforeAll(async () => {
      container = getContainer()
      const { user: adminUser, authIdentity: authId } = await createAdminUser(
        dbConnection,
        adminHeaders,
        container
      )

      user = adminUser
      authIdentity = authId

      await dbUtils.snapshot()
    })

    describe("GET /admin/users/:id", () => {
      it("should return user by id", async () => {
        const response = await api.get(`/admin/users/${user.id}`, adminHeaders)

        const v2Response = {
          id: user.id,
          email: "admin@medusa.js",
          created_at: expect.any(String),
          updated_at: expect.any(String),
        }

        // BREAKING: V2 users do not have role + api_token
        expect(response.status).toEqual(200)
        expect(response.data.user).toEqual(expect.objectContaining(v2Response))
      })
    })

    describe("GET /admin/users", () => {
      it("should list users", async () => {
        const response = await api.get("/admin/users", adminHeaders)

        expect(response.status).toEqual(200)

        const v2Response = [
          expect.objectContaining({
            id: user.id,
            email: "admin@medusa.js",
            created_at: expect.any(String),
            updated_at: expect.any(String),
          }),
        ]

        expect(response.data.users).toEqual(v2Response)
      })

      it("should list users that match the free text search", async () => {
        const emptyResponse = await api.get(
          "/admin/users?q=member",
          adminHeaders
        )

        expect(emptyResponse.status).toEqual(200)
        expect(emptyResponse.data.users.length).toEqual(0)

        const response = await api.get("/admin/users?q=user", adminHeaders)

        expect(response.data.users.length).toEqual(1)
        expect(response.data.users).toEqual([
          expect.objectContaining({
            id: user.id,
            email: "admin@medusa.js",
            created_at: expect.any(String),
            updated_at: expect.any(String),
          }),
        ])
      })
    })

    describe("POST /admin/users/:id", () => {
      it("should update a user", async () => {
        const updateResponse = (
          await api.post(
            `/admin/users/${user.id}`,
            { first_name: "John", last_name: "Doe" },
            adminHeaders
          )
        ).data.user

        expect(updateResponse).toEqual(
          expect.objectContaining({
            id: user.id,
            created_at: expect.any(String),
            updated_at: expect.any(String),
            first_name: "John",
            last_name: "Doe",
          })
        )
      })
    })

    describe("DELETE /admin/users", () => {
      it("Deletes a user and its auth identity when the user is the only associated actor", async () => {
        const userTwoAdminHeaders = {
          headers: { "x-medusa-access-token": "test_token" },
        }

        const { user: userTwo, authIdentity: userTwoAuthIdentity } =
          await createAdminUser(dbConnection, userTwoAdminHeaders, container, {
            email: "test@test.com",
          })

        const authModule: IAuthModuleService = container.resolve(Modules.AUTH)

        const response = await api.delete(
          `/admin/users/${userTwo.id}`,
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data).toEqual({
          id: userTwo.id,
          object: "user",
          deleted: true,
        })

        // The user was the only actor associated with the auth identity, so the
        // whole auth identity should be deleted.
        await expect(
          authModule.retrieveAuthIdentity(userTwoAuthIdentity.id)
        ).rejects.toThrow()

        // And its provider identity should be cascade-deleted along with it, so
        // authentication with the old credentials should no longer succeed.
        const authError = await api
          .post(`/auth/user/emailpass`, {
            email: userTwo.email,
            password: "somepassword",
          })
          .catch((e) => e)

        expect(authError.response.status).toEqual(401)

        // And the provider identity should no longer exist.
        const providerIdentities = await authModule.listProviderIdentities({
          entity_id: userTwo.email,
        })
        expect(providerIdentities).toHaveLength(0)
      })

      it("Keeps the auth identity when another non-null actor type is still associated", async () => {
        const userThreeAdminHeaders = {
          headers: { "x-medusa-access-token": "test_token" },
        }

        const { user: userThree, authIdentity: userThreeAuthIdentity } =
          await createAdminUser(
            dbConnection,
            userThreeAdminHeaders,
            container,
            {
              email: "test-multi@test.com",
            }
          )

        const authModule: IAuthModuleService = container.resolve(Modules.AUTH)

        // Associate another (non-null) actor type with the same auth identity.
        await authModule.updateAuthIdentities({
          id: userThreeAuthIdentity.id,
          app_metadata: {
            user_id: userThree.id,
            customer_id: "cus_123",
          },
        })

        const response = await api.delete(
          `/admin/users/${userThree.id}`,
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data).toEqual({
          id: userThree.id,
          object: "user",
          deleted: true,
        })

        // The auth identity must be kept since another actor is still associated.
        const authIdentity = await authModule.retrieveAuthIdentity(
          userThreeAuthIdentity.id
        )

        expect(authIdentity).toEqual(
          expect.objectContaining({
            id: userThreeAuthIdentity.id,
            app_metadata: expect.objectContaining({
              // The other actor type keeps its value...
              customer_id: "cus_123",
              // ...while the deleted actor's entry is set to null.
              user_id: null,
            }),
          })
        )

        // The provider identity should still exist since the auth identity was kept.
        const providerIdentities = await authModule.listProviderIdentities({
          entity_id: userThree.email,
        })
        expect(providerIdentities).toHaveLength(1)
      })

      it("throws if you attempt to delete your own user", async () => {
        const error = await api
          .delete(`/admin/users/${user.id}`, adminHeaders)
          .catch((e) => e)

        expect(error.response.status).toEqual(400)
        expect(error.response.data.message).toEqual(
          "A user cannot delete itself"
        )
      })

      // TODO: Migrate when analytics config is implemented in 2.0
      it.skip("Deletes a user and their analytics config", async () => {
        const userId = "member-user"

        // await simpleAnalyticsConfigFactory(dbConnection, {
        //   user_id: userId,
        // })

        const response = await api.delete(
          `/admin/users/${userId}`,
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data).toEqual({
          id: userId,
          object: "user",
          deleted: true,
        })

        const configs = await dbConnection.manager.query(
          `SELECT * FROM public.analytics_config WHERE user_id = '${userId}'`
        )

        expect(configs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              created_at: expect.any(Date),
              updated_at: expect.any(Date),
              deleted_at: expect.any(Date),
              id: expect.any(String),
              user_id: userId,
              opt_out: false,
              anonymize: false,
            }),
          ])
        )
      })
    })

    describe("GET /admin/users/:id/auth-providers", () => {
      it("lists the auth providers the user can authenticate with", async () => {
        const response = await api.get(
          `/admin/users/${user.id}/auth-providers`,
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.providers).toEqual(["emailpass"])
      })

      it("returns an empty list for a user without an auth identity", async () => {
        const userModule = container.resolve(Modules.USER)
        const providerlessUser = await userModule.createUsers({
          email: "no-auth-identity@test.com",
        })

        const response = await api.get(
          `/admin/users/${providerlessUser.id}/auth-providers`,
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.providers).toEqual([])
      })
    })

    describe("POST /admin/users/:id/reset-password", () => {
      it("returns a token that the user can use to reset their password", async () => {
        const email = "reset-link@test.com"

        const resetUserHeaders = {
          headers: { "x-medusa-access-token": "test_token" },
        }

        const { user: resetUser } = await createAdminUser(
          dbConnection,
          resetUserHeaders,
          container,
          { email }
        )

        const response = await api.post(
          `/admin/users/${resetUser.id}/reset-password`,
          {},
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data).toEqual({ token: expect.any(String) })

        const updateResponse = await api.post(
          `/auth/user/emailpass/update`,
          { password: "new_password" },
          { headers: { authorization: `Bearer ${response.data.token}` } }
        )

        expect(updateResponse.status).toEqual(200)

        const loginResponse = await api.post("/auth/user/emailpass", {
          email,
          password: "new_password",
        })

        expect(loginResponse.status).toEqual(200)
      })

      it("throws when the user does not exist", async () => {
        const error = await api
          .post(
            `/admin/users/usr_does-not-exist/reset-password`,
            {},
            adminHeaders
          )
          .catch((e) => e)

        expect(error.response.status).toEqual(404)
        expect(error.response.data.message).toEqual(
          "User with id: usr_does-not-exist was not found"
        )
      })
    })

    // TODO: Migrate when implemented in 2.0
    describe.skip("POST /admin/users/reset-password + POST /admin/users/password-token", () => {
      let user
      beforeEach(async () => {
        const response = await api
          .post(
            "/admin/users",
            {
              email: "test@forgottenPassword.com",
              role: "member",
              password: "test123453",
            },
            adminHeaders
          )
          .catch((err) => console.log(err))

        user = response.data.user
      })

      it("Doesn't fail to fetch user when resetting password for an unknown email (unauthorized endpoint)", async () => {
        const resp = await api.post("/admin/users/password-token", {
          email: "test-doesnt-exist@test.com",
        })

        expect(resp.status).toEqual(204)
      })

      it("Doesn't fail when generating password reset token (unauthorized endpoint)", async () => {
        const resp = await api
          .post("/admin/users/password-token", {
            email: user.email,
          })
          .catch((err) => {
            console.log(err)
          })

        expect(resp.data).toEqual("")
        expect(resp.status).toEqual(204)
      })

      it("Resets the password given a valid token (unauthorized endpoint)", async () => {
        const expiry = Math.floor(Date.now() / 1000) + 60 * 15
        const dbUser = await dbConnection.manager.query(
          `SELECT * FROM public.user WHERE email = '${user.email}'`
        )

        const token_payload = {
          user_id: user.id,
          email: user.email,
          exp: expiry,
        }
        const token = jwt.sign(token_payload, dbUser[0].password_hash)

        const result = await api
          .post("/admin/users/reset-password", {
            token,
            email: "test@forgottenpassword.com",
            password: "new password",
          })
          .catch((err) => console.log(err))

        const loginResult = await api.post("admin/auth", {
          email: "test@forgottenpassword.com",
          password: "new password",
        })

        expect(result.status).toEqual(200)
        expect(result.data.user).toEqual(
          expect.objectContaining({
            email: user.email,
            role: user.role,
          })
        )
        expect(result.data.user.password_hash).toEqual(undefined)

        expect(loginResult.status).toEqual(200)
        expect(loginResult.data.user).toEqual(
          expect.objectContaining({
            email: user.email,
            role: user.role,
          })
        )
      })

      it("Resets the password given a valid token without including email(unauthorized endpoint)", async () => {
        const expiry = Math.floor(Date.now() / 1000) + 60 * 15
        const dbUser = await dbConnection.manager.query(
          `SELECT * FROM public.user WHERE email = '${user.email}'`
        )

        const token_payload = {
          user_id: user.id,
          email: user.email,
          exp: expiry,
        }
        const token = jwt.sign(token_payload, dbUser[0].password_hash)

        const result = await api
          .post("/admin/users/reset-password", {
            token,
            password: "new password",
          })
          .catch((err) => console.log(err.response.data.message))

        const loginResult = await api.post("admin/auth", {
          email: user.email,
          password: "new password",
        })

        expect(result.status).toEqual(200)
        expect(result.data.user).toEqual(
          expect.objectContaining({
            email: user.email,
            role: user.role,
          })
        )
        expect(result.data.user.password_hash).toEqual(undefined)

        expect(loginResult.status).toEqual(200)
        expect(loginResult.data.user).toEqual(
          expect.objectContaining({
            email: user.email,
            role: user.role,
          })
        )
      })

      it("Fails to Reset the password given an invalid token (unauthorized endpoint)", async () => {
        expect.assertions(2)

        const token = "test.test.test"

        await api
          .post("/admin/users/reset-password", {
            token,
            email: "test@forgottenpassword.com",
            password: "new password",
          })
          .catch((err) => {
            expect(err.response.status).toEqual(400)
            expect(err.response.data.message).toEqual("invalid token")
          })
      })
    })
  },
})
