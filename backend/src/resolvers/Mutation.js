const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const { promisify } = require('util');
const { transport, makeANiceEmail } = require('../mail');
const { hasPermission } = require('../utils');
const stripe = require('../stripe');

const Mutations = {
  async createItem(parent, args, ctx, info) {
    if(!ctx.request.userId) {
      throw Error('You must be logged in to do that!');
    }

    const item = await ctx.db.mutation.createItem(
      {
        data: {
          // this is how we create a relationship between item and user
          user: {
            connect: {
              id: ctx.request.userId,
            },
          },
          ...args,
        },
      },
      info
    );

    console.log(item);

    return item;
  },
  updateItem(parent, args, ctx, info) {
    // first take a copy of the updates
    const updates = { ...args };
    // remove the ID from the updates
    delete updates.id;
    // run update method
    return ctx.db.mutation.updateItem(
      {
        data: updates,
        where: {
          id: args.id,
        },
      },
      info
    );
  },
  async deleteItem(parent, args, ctx, info) {
    const where = { id: args.id };
    // 1. find the item
    const item = await ctx.db.query.item({ where }, `{ id title user{ id }}`);
    // 2. check if they own that item or have the permission
    const ownsItem = item.user.id === ctx.request.userId;
    const hasPermissions = ctx.request.user.permissions.some(permission => ['ADMIN', 'ITEMDELETE'].includes(permission));

    if(!ownsItem && hasPermissions) {
      throw new Error('You don\'t have permission to do that!');
    }
    // 3. delete it!
    return ctx.db.mutation.deleteItem({ where }, info);
  },
  async signup(parent, args, ctx, info) {
    // lowercase their email
    args.email = args.email.toLowerCase();
    // hash their password
    const password = await bcrypt.hash(args.password, 10);
    // create the user in the database
    const user = await ctx.db.mutation.createUser({
      data: {
        ...args,
        password,
        permissions: { set: ['USER'] }
        }
      }, info
    );
    // create JWT token for them
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    // we set the jwt as a cookie on the response
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 360, // 1 year cookie
    });
    // return user to the browser
    return user;
  },
  async signin(parents, {email, password}, ctx, info) {
    // 1. check if there is a user with that email
    const user = await ctx.db.query.user({ where: { email} });
    if (!user) {
      throw new Error(`No such user found for email ${email}`);
    }
    // 2. check if their password is correct
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new Error('Invalid Password!');
    }
    // 3. generate the JWT Token
    const token = jwt.sign({ userId: user.id}, process.env.APP_SECRET);
    // 4. set the cookie with the token
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    // 5. return the user
    return user;
  },
  signout(parent, args, ctx, info) {
    ctx.response.clearCookie('token');
    return { message: 'Goodbye!' };
  },
  async requestReset(parent, args, ctx, info) {
    // 1. check if this is a real user
    const user = await ctx.db.query.user( { where: { email: args.email } });

    if (!user) {
      throw new Error(`No such user found for email ${args.email}`);
    }
    // 2. set a reset token and expiry on that user
    const randomBytesPromiseified = promisify(randomBytes);
    const resetToken = (await randomBytesPromiseified(20)).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
    const res = ctx.db.mutation.updateUser({
      where: { email: args.email },
      data: { resetToken, resetTokenExpiry }
    });
    // 3. email them the reset token
    const mailRes = await transport.sendMail({
      from: 'kevin@kevin.com',
      to: user.email,
      subject: 'Your Password Reset Token',
      html: makeANiceEmail(`Your Password Reset Token is here!
       \n\n
       <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}">Click Here to Reset</a>`),
    });

    //4. return the message
    return { message: 'Thanks!'}
  },
  async resetPassword(parent, args, ctx, info) {
    // 1. check if passwords match
    if (args.password !== args.confirmPassword) {
      throw new Error('Your password does not match!');
    }
    // 2. check if it is a legit reset token
    // 3. check if it is expired
    const [user] = await ctx.db.query.users({
      where: {
        resetToken: args.resetToken,
        resetTokenExpiry_gte: Date.now() - 3600000
      },
    });
    if (!user) {
      throw new Error('This token is either invalid or expired!');
    }
    // 4. hash for their new password
    const password = await bcrypt.hash(args.password, 10);
    // 5. save new password for user and remove old resetToken fields
    const updatedUser = await ctx.db.mutation.updateUser({
      where: { email: user.email },
      data: {
        password,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });
    // 6. generate JWT
    const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
    // 7. set JWT cookie
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    // 8. return the new user
    return updatedUser;
  },
  async updatePermissions(parent, args, ctx, info) {
    // 1. check if they are logged in
    if (!ctx.request.userId) {
      throw new Error('You must be logged in');
    }
    // 2. query the current user
    const currentUser = await ctx.db.query.user(
      {
        where: {
          id: ctx.request.userId,
        },
      },
      info
    );
    // 3. check if they have permissions to do this
      hasPermission(currentUser, ['ADMIN', 'PERMISSIONUPDATE']);
    // 4. update the permissions
    return ctx.db.mutation.updateUser({
      data: {
        permissions: {
          set: args.permissions,
        }
      },
      where: {
        id: args.userId
      },
    }, info);
  },
  async addToCart(parent, args, ctx, info) {
    // 1. Make sure they are signed in
    const userId = ctx.request.userId;
    if(!userId) {
      throw new Error('You must be signed in!');
    }
    // 2. Query the users current cart
    const [existingCartItem] = await ctx.db.query.cartItems({
      where: {
        user: { id: userId },
        item: { id: args.id },
      }
    });
    // 3. Check if that item is already in their cart
    if(existingCartItem) {
      console.log('This item is already in their cart');
      return ctx.db.mutation.updateCartItem({
        where: { id: existingCartItem.id },
        data: { quantity: existingCartItem.quantity + 1 }
      },
      info
      );
    }
    // increment by 1 if it is
    // if not, create a fresh cartItem for that user!
    return ctx.db.mutation.createCartItem({
      data: {
        user: {
          connect: { id: userId },
        },
        item: {
          connect: { id: args.id }
        },
      },
    }, info
    );
  },
  async removeFromCart(parent, args, ctx, info) {
    // 1. find cart item
    const cartItem = await ctx.db.query.cartItem({
      where: {
        id: args.id,
      },
    },
    `{id, user { id }}`
    );
    // 1.5. make sure we found an item
    if(!cartItem) throw new Error('No CartItem found!');
    // 2. make sure they own that cart item
    if(cartItem.user.id !== ctx.request.userId) {
      throw new Error('You do not own this cart item');
    }
    // 3. delete that cart item
    return ctx.db.mutation.deleteCartItem({
      where: { id: args.id },
    }, info);
  },
  async createOrder(parent, args, ctx, info) {
    // 1. Query the current user and make sure they are signed in
    const { userId } = ctx.request;
    if (!userId) throw new Error("You must be signed in to complete this order.");
    const user = await ctx.db.query.user({ where: { id: userId } }, `{
      id
      name
      email
      cart {
        id
        quantity
        item {
          title
          price
          id
          description
          image
          largeImage
        }
      }}`
    );
    // 2. Recalculate the total for the price to avoid user's adjusting price with JS on client side
      const amount = user.cart.reduce((tally, cartItem) => tally + cartItem.item.price * cartItem.quantity, 0);
    // 3. Create the stripe charge (trun token into $$$)
      const charge = await stripe.charges.create({
        amount,
        currency: 'USD',
        source: args.token,
      });
    // 4. Convert the cartItems to OrderItems
      const orderItems = user.cart.map(cartItem => {
        const orderItem = {
          ...cartItem.item,
          quantity: cartItem.quantity,
          user: { connect: { id: userId } },
        };
        delete orderItem.id;
        return orderItem;
      });
    // 5. create the order
      const order = await ctx.db.mutation.createOrder({
        data: {
          total: charge.amount,
          charge: charge.id,
          items: { create: orderItems },
          user: { connect: { id: userId } },
        },
      });
    // 6. Clean up - clear the user's cart, delete CartItems
      const cartItemIds = user.cart.map(cartItem => cartItem.id);
      await ctx.db.mutation.deleteManyCartItems({
        where: {
          id_in: cartItemIds,
        },
      });
    // 7. Return the order to the client
    return order;
  }
};

module.exports = Mutations;
